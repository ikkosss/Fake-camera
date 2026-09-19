package mark.via.fakecam;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.webkit.WebChromeClient;

import androidx.fragment.app.Fragment;

/**
 * Redirects web camera capture requests to the device gallery.
 *
 * <p>When a page uses {@code <input type="file" capture>} the browser is expected to launch a
 * camera app. This hook answers such requests with a gallery picker instead, so the picture the
 * user selects reaches the page as if it had just been taken.
 */
public final class FakeCamera {

    /** Request code Via already uses for its own file chooser, so its result handler picks it up. */
    private static final int FILE_CHOOSER_REQUEST_CODE = 0x6f;

    private FakeCamera() {
    }

    /**
     * @return {@code true} when the gallery picker was started and the caller must not open its
     *         own file chooser, {@code false} to keep Via's default behaviour.
     */
    public static boolean interceptCapture(Fragment fragment, WebChromeClient.FileChooserParams params) {
        if (fragment == null || params == null) {
            return false;
        }
        try {
            if (!params.isCaptureEnabled()) {
                return false;
            }
            Context context = fragment.I();
            if (context == null) {
                return false;
            }
            Intent picker = buildPickerIntent(context, wantsVideo(params));
            if (picker == null) {
                return false;
            }
            fragment.P2(picker, FILE_CHOOSER_REQUEST_CODE);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static boolean wantsVideo(WebChromeClient.FileChooserParams params) {
        String[] acceptTypes = params.getAcceptTypes();
        if (acceptTypes == null || acceptTypes.length == 0) {
            return false;
        }
        boolean sawVideo = false;
        for (String acceptType : acceptTypes) {
            if (acceptType == null) {
                continue;
            }
            String type = acceptType.trim().toLowerCase();
            if (type.isEmpty()) {
                continue;
            }
            if (type.startsWith("image/") || type.equals(".jpg") || type.equals(".jpeg")
                    || type.equals(".png") || type.equals(".webp")) {
                return false;
            }
            if (type.startsWith("video/") || type.equals(".mp4") || type.equals(".3gp")) {
                sawVideo = true;
            }
        }
        return sawVideo;
    }

    private static Intent buildPickerIntent(Context context, boolean video) {
        String mimeType = video ? "video/*" : "image/*";

        if (Build.VERSION.SDK_INT >= 33) {
            Intent photoPicker = new Intent(MediaStore.ACTION_PICK_IMAGES);
            photoPicker.setType(mimeType);
            if (canHandle(context, photoPicker)) {
                return photoPicker;
            }
        }

        Uri collection = video
                ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        Intent gallery = new Intent(Intent.ACTION_PICK, collection);
        gallery.setType(mimeType);
        if (canHandle(context, gallery)) {
            return gallery;
        }

        Intent content = new Intent(Intent.ACTION_GET_CONTENT);
        content.addCategory(Intent.CATEGORY_OPENABLE);
        content.setType(mimeType);
        return canHandle(context, content) ? content : null;
    }

    private static boolean canHandle(Context context, Intent intent) {
        try {
            return intent.resolveActivity(context.getPackageManager()) != null;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
