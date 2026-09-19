package androidx.fragment.app;

import android.content.Context;
import android.content.Intent;

/**
 * Compile-time stub only. Via's bundled AndroidX is obfuscated by R8, so inside the APK
 * {@code getContext()} is named {@code I()} and {@code startActivityForResult(Intent, int)} is
 * named {@code P2(Intent, int)}. This stub lets the patch link against those names; it is never
 * packaged into the APK.
 */
public class Fragment {

    public Context I() {
        throw new UnsupportedOperationException("stub");
    }

    public void P2(Intent intent, int requestCode) {
        throw new UnsupportedOperationException("stub");
    }
}
