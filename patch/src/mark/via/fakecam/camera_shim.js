/*
 * Replaces the live camera with a still picture chosen from the gallery.
 *
 * Injected into every page at load start. When a page calls getUserMedia() for video this asks
 * the user to pick an image, paints it onto a canvas and hands back that canvas as the camera
 * stream, so the page sees a working camera showing the selected picture.
 */
(function () {
    'use strict';

    if (window.__viaGalleryCamera) {
        return;
    }
    window.__viaGalleryCamera = true;

    var DEVICE_ID = 'via-gallery-camera';
    var DEVICE_LABEL = 'Camera';

    function fail(message, name) {
        try {
            return new DOMException(message, name);
        } catch (e) {
            var error = new Error(message);
            error.name = name;
            return error;
        }
    }

    /** Opens the gallery through a throwaway file input and resolves with the decoded image. */
    function pickImage() {
        return new Promise(function (resolve, reject) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            // The native hook turns a capture request straight into the gallery picker.
            input.setAttribute('capture', 'environment');
            input.setAttribute('style', 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0');

            var settled = false;
            function finish(file) {
                if (settled) {
                    return;
                }
                settled = true;
                try {
                    input.parentNode.removeChild(input);
                } catch (e) {
                }
                if (!file) {
                    reject(fail('No image was selected', 'NotAllowedError'));
                    return;
                }
                var reader = new FileReader();
                reader.onload = function () {
                    var image = new Image();
                    image.onload = function () {
                        resolve(image);
                    };
                    image.onerror = function () {
                        reject(fail('The selected image could not be decoded', 'NotReadableError'));
                    };
                    image.src = reader.result;
                };
                reader.onerror = function () {
                    reject(fail('The selected image could not be read', 'NotReadableError'));
                };
                reader.readAsDataURL(file);
            }

            input.addEventListener('change', function () {
                finish(input.files && input.files[0]);
            });
            input.addEventListener('cancel', function () {
                finish(null);
            });

            (document.body || document.documentElement).appendChild(input);
            input.click();
        });
    }

    function resolveSize(constraint, fallback) {
        if (typeof constraint === 'number') {
            return constraint;
        }
        if (constraint && typeof constraint === 'object') {
            var candidate = constraint.ideal || constraint.exact || constraint.max || constraint.min;
            if (typeof candidate === 'number') {
                return candidate;
            }
        }
        return fallback;
    }

    /** Wraps the image in a canvas capture stream that keeps producing frames. */
    function streamFromImage(image, videoConstraints) {
        var wanted = (videoConstraints && typeof videoConstraints === 'object') ? videoConstraints : {};
        var width = Math.round(resolveSize(wanted.width, image.naturalWidth || 1280)) || 1280;
        var height = Math.round(resolveSize(wanted.height, image.naturalHeight || 720)) || 720;

        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var context = canvas.getContext('2d');

        var scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
        var drawWidth = image.naturalWidth * scale;
        var drawHeight = image.naturalHeight * scale;
        var left = (width - drawWidth) / 2;
        var top = (height - drawHeight) / 2;

        function paint() {
            context.fillStyle = '#000000';
            context.fillRect(0, 0, width, height);
            context.drawImage(image, left, top, drawWidth, drawHeight);
        }

        paint();
        var stream = canvas.captureStream(30);
        var ticker = setInterval(paint, 66);

        var track = stream.getVideoTracks()[0];
        if (track) {
            var settings = {
                deviceId: DEVICE_ID,
                groupId: DEVICE_ID,
                width: width,
                height: height,
                aspectRatio: width / height,
                frameRate: 30,
                resizeMode: 'none',
                facingMode: typeof wanted.facingMode === 'string' ? wanted.facingMode : 'environment'
            };
            try {
                Object.defineProperty(track, 'label', { value: DEVICE_LABEL, configurable: true });
            } catch (e) {
            }
            track.getSettings = function () {
                return settings;
            };
            track.getCapabilities = function () {
                return {
                    deviceId: DEVICE_ID,
                    groupId: DEVICE_ID,
                    width: { min: 1, max: width },
                    height: { min: 1, max: height },
                    frameRate: { min: 1, max: 30 },
                    facingMode: ['environment', 'user']
                };
            };
            track.getConstraints = function () {
                return wanted;
            };
            track.applyConstraints = function () {
                return Promise.resolve();
            };
            var stop = track.stop.bind(track);
            track.stop = function () {
                clearInterval(ticker);
                stop();
            };
            track.addEventListener('ended', function () {
                clearInterval(ticker);
            });
        }
        return stream;
    }

    var mediaDevices = navigator.mediaDevices;
    var realGetUserMedia = (mediaDevices && mediaDevices.getUserMedia)
        ? mediaDevices.getUserMedia.bind(mediaDevices)
        : null;
    var realEnumerateDevices = (mediaDevices && mediaDevices.enumerateDevices)
        ? mediaDevices.enumerateDevices.bind(mediaDevices)
        : null;

    function galleryGetUserMedia(constraints) {
        var request = constraints || {};
        if (!request.video) {
            return realGetUserMedia
                ? realGetUserMedia(request)
                : Promise.reject(fail('Audio capture is unavailable', 'NotFoundError'));
        }
        return pickImage().then(function (image) {
            var stream = streamFromImage(image, request.video);
            if (!request.audio || !realGetUserMedia) {
                return stream;
            }
            return realGetUserMedia({ audio: request.audio }).then(function (withAudio) {
                withAudio.getAudioTracks().forEach(function (audioTrack) {
                    stream.addTrack(audioTrack);
                });
                return stream;
            }, function () {
                return stream;
            });
        });
    }

    function galleryEnumerateDevices() {
        var camera = {
            deviceId: DEVICE_ID,
            groupId: DEVICE_ID,
            kind: 'videoinput',
            label: DEVICE_LABEL,
            toJSON: function () {
                return this;
            }
        };
        if (!realEnumerateDevices) {
            return Promise.resolve([camera]);
        }
        return realEnumerateDevices().then(function (devices) {
            var kept = (devices || []).filter(function (device) {
                return device.kind !== 'videoinput';
            });
            kept.push(camera);
            return kept;
        }, function () {
            return [camera];
        });
    }

    if (!mediaDevices) {
        // Insecure origins expose no mediaDevices at all, so provide the two methods pages use.
        try {
            Object.defineProperty(navigator, 'mediaDevices', {
                configurable: true,
                value: {
                    getUserMedia: galleryGetUserMedia,
                    enumerateDevices: galleryEnumerateDevices,
                    getSupportedConstraints: function () {
                        return { width: true, height: true, facingMode: true, frameRate: true };
                    },
                    addEventListener: function () {
                    },
                    removeEventListener: function () {
                    }
                }
            });
        } catch (e) {
        }
    } else {
        mediaDevices.getUserMedia = galleryGetUserMedia;
        mediaDevices.enumerateDevices = galleryEnumerateDevices;
        try {
            if (window.MediaDevices && window.MediaDevices.prototype) {
                window.MediaDevices.prototype.getUserMedia = galleryGetUserMedia;
                window.MediaDevices.prototype.enumerateDevices = galleryEnumerateDevices;
            }
        } catch (e) {
        }
    }

    function legacyGetUserMedia(constraints, onSuccess, onError) {
        galleryGetUserMedia(constraints).then(onSuccess, onError);
    }

    navigator.getUserMedia = legacyGetUserMedia;
    navigator.webkitGetUserMedia = legacyGetUserMedia;
    navigator.mozGetUserMedia = legacyGetUserMedia;
})();
