/*
 * End-to-end check of camera_shim.js in a real Chromium.
 *
 *   npm install puppeteer-core
 *   CHROME=/usr/bin/google-chrome node patch/test/shim_test.js
 *
 * The page asks for a camera through getUserMedia(). The shim must answer with a file picker
 * (the gallery on Android), and the resulting stream must show the picked picture: the test
 * feeds in an image whose left half is red and right half is blue, then samples a frame.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHIM = fs.readFileSync(path.join(__dirname, '..', 'src', 'mark', 'via', 'fakecam', 'camera_shim.js'), 'utf8');
const IMAGE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shim-test-')), 'picture.png');
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>shim test</title></head><body></body></html>';

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(PAGE);
        });
        // localhost counts as a secure context, so navigator.mediaDevices exists as it does in Via.
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function writeTestImage(browser) {
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 400, 600);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(400, 0, 400, 600);
        return canvas.toDataURL('image/png');
    });
    await page.close();
    fs.writeFileSync(IMAGE_PATH, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

/** Runs inside the page: takes a camera stream and samples one frame from it. */
const grabFrame = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const track = stream.getVideoTracks()[0];
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    document.body.appendChild(video);
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, 700));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const at = (x, y) => {
        const offset = (y * canvas.width + x) * 4;
        return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    };

    const result = {
        trackLabel: track.label,
        settings: track.getSettings(),
        frameSize: [video.videoWidth, video.videoHeight],
        leftPixel: at(Math.round(canvas.width * 0.25), Math.round(canvas.height / 2)),
        rightPixel: at(Math.round(canvas.width * 0.75), Math.round(canvas.height / 2)),
        readyState: track.readyState,
    };
    track.stop();
    result.afterStop = track.readyState;
    return result;
};

async function main() {
    const server = await startServer();
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    await writeTestImage(browser);

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.evaluateOnNewDocument(SHIM);
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });

    console.log('shim installed:', await page.evaluate(() => window.__viaGalleryCamera === true));
    console.log('video inputs reported:', JSON.stringify(await page.evaluate(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter((device) => device.kind === 'videoinput').map((device) => device.label);
    })));

    // Arm the interception before the shim clicks its hidden input.
    const chooserPromise = page.waitForFileChooser({ timeout: 20000 });
    const pending = page.evaluate(grabFrame);
    const chooser = await chooserPromise;
    console.log('shim opened a file picker instead of the camera');
    await chooser.accept([IMAGE_PATH]);

    const result = await pending;
    console.log('result:', JSON.stringify(result, null, 2));
    console.log('page errors:', pageErrors.length ? pageErrors : 'none');

    const [leftRed, leftGreen, leftBlue] = result.leftPixel;
    const [rightRed, rightGreen, rightBlue] = result.rightPixel;
    const ok = leftRed > 200 && leftGreen < 60 && leftBlue < 60
        && rightBlue > 200 && rightRed < 60 && rightGreen < 60;

    await browser.close();
    server.close();

    console.log(ok ? 'PASS: the camera stream shows the picked image' : 'FAIL: unexpected frame content');
    process.exit(ok ? 0 : 1);
}

main().catch((error) => {
    console.error('TEST ERROR', error);
    process.exit(1);
});
