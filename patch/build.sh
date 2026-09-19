#!/usr/bin/env bash
#
# Rebuilds Via with the gallery-instead-of-camera patch and produces a signed APK.
#
#   ./patch/build.sh
#
# Everything is created under build/ and the signed APK is copied to dist/.
# Required tools (apktool, Android SDK build-tools) are downloaded on first run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$REPO_ROOT/patch"
BUILD_DIR="$REPO_ROOT/build"
DIST_DIR="$REPO_ROOT/dist"
CACHE_DIR="${FAKECAM_CACHE_DIR:-$HOME/.cache/via-fakecam}"

APKTOOL_VERSION="2.12.1"
APKTOOL_JAR="$CACHE_DIR/apktool_$APKTOOL_VERSION.jar"
APKTOOL_URL="https://github.com/iBotPeaches/Apktool/releases/download/v$APKTOOL_VERSION/apktool_$APKTOOL_VERSION.jar"

# Apktool ships a stripped baksmali, so the real disassembler is fetched separately.
BAKSMALI_DIR="$CACHE_DIR/baksmali"
BAKSMALI_JARS=(
    "https://dl.google.com/dl/android/maven2/com/android/tools/smali/smali-baksmali/3.0.9/smali-baksmali-3.0.9.jar"
    "https://dl.google.com/dl/android/maven2/com/android/tools/smali/smali-dexlib2/3.0.9/smali-dexlib2-3.0.9.jar"
    "https://dl.google.com/dl/android/maven2/com/android/tools/smali/smali-util/3.0.9/smali-util-3.0.9.jar"
    "https://repo1.maven.org/maven2/com/google/guava/guava/31.1-android/guava-31.1-android.jar"
    "https://repo1.maven.org/maven2/com/beust/jcommander/1.82/jcommander-1.82.jar"
)

ANDROID_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$CACHE_DIR/android-sdk}}"
BUILD_TOOLS_VERSION="36.0.0"
PLATFORM_VERSION="android-36"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip"

KEYSTORE="$CACHE_DIR/fakecam.keystore"
KEY_ALIAS="fakecam"
KEY_PASSWORD="fakecam"

APK_NAME="Via_7.3.3_fakecam.apk"

log() { printf '\n==> %s\n' "$1"; }

ensure_apktool() {
    mkdir -p "$CACHE_DIR"
    if [[ ! -f "$APKTOOL_JAR" ]]; then
        log "Downloading Apktool $APKTOOL_VERSION"
        curl -sSL -o "$APKTOOL_JAR" "$APKTOOL_URL"
    fi
}

ensure_baksmali() {
    mkdir -p "$BAKSMALI_DIR"
    for url in "${BAKSMALI_JARS[@]}"; do
        local jar="$BAKSMALI_DIR/$(basename "$url")"
        [[ -f "$jar" ]] || { log "Downloading $(basename "$url")"; curl -sSL -o "$jar" "$url"; }
    done
}

ensure_android_sdk() {
    local sdkmanager="$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager"
    if [[ ! -x "$sdkmanager" ]]; then
        log "Downloading Android command line tools"
        mkdir -p "$ANDROID_SDK/cmdline-tools"
        curl -sSL -o "$CACHE_DIR/cmdline-tools.zip" "$CMDLINE_TOOLS_URL"
        unzip -q -o "$CACHE_DIR/cmdline-tools.zip" -d "$ANDROID_SDK/cmdline-tools"
        rm -rf "$ANDROID_SDK/cmdline-tools/latest"
        mv "$ANDROID_SDK/cmdline-tools/cmdline-tools" "$ANDROID_SDK/cmdline-tools/latest"
    fi
    if [[ ! -d "$ANDROID_SDK/build-tools/$BUILD_TOOLS_VERSION" || ! -d "$ANDROID_SDK/platforms/$PLATFORM_VERSION" ]]; then
        log "Installing build-tools $BUILD_TOOLS_VERSION and $PLATFORM_VERSION"
        yes | "$sdkmanager" --licenses >/dev/null 2>&1 || true
        "$sdkmanager" "build-tools;$BUILD_TOOLS_VERSION" "platforms;$PLATFORM_VERSION" >/dev/null
    fi
}

ensure_keystore() {
    if [[ ! -f "$KEYSTORE" ]]; then
        log "Creating signing keystore"
        keytool -genkeypair -v \
            -keystore "$KEYSTORE" \
            -storepass "$KEY_PASSWORD" \
            -keypass "$KEY_PASSWORD" \
            -alias "$KEY_ALIAS" \
            -keyalg RSA -keysize 2048 -validity 10950 \
            -dname "CN=Via FakeCamera, OU=patch, O=patch, C=US" >/dev/null 2>&1
    fi
}

ensure_apktool
ensure_baksmali
ensure_android_sdk
ensure_keystore

BUILD_TOOLS="$ANDROID_SDK/build-tools/$BUILD_TOOLS_VERSION"
ANDROID_JAR="$ANDROID_SDK/platforms/$PLATFORM_VERSION/android.jar"
D8="$ANDROID_SDK/cmdline-tools/latest/bin/d8"

SRC_ZIP="$(ls "$REPO_ROOT"/Via_*_base_src.zip | head -1)"
[[ -f "$SRC_ZIP" ]] || { echo "decompiled sources archive not found in $REPO_ROOT" >&2; exit 1; }

log "Unpacking $(basename "$SRC_ZIP")"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/src"
unzip -q -o "$SRC_ZIP" -d "$BUILD_DIR/src"

log "Converting APKTool M metadata to apktool.yml"
python3 "$PATCH_DIR/tools/json2yml.py" \
    "$BUILD_DIR/src/apktool.json" \
    "$BUILD_DIR/src/apktool.yml" \
    "$APKTOOL_VERSION"

log "Compiling FakeCamera"
mkdir -p "$BUILD_DIR/stub-classes" "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$BUILD_DIR/generated"
python3 "$PATCH_DIR/tools/embed_js.py" \
    "$PATCH_DIR/src/mark/via/fakecam/camera_shim.js" \
    "$BUILD_DIR/generated"
javac -nowarn -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
    -d "$BUILD_DIR/stub-classes" \
    $(find "$PATCH_DIR/stubs" -name '*.java') 2>/dev/null
javac -nowarn -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
    -classpath "$BUILD_DIR/stub-classes" \
    -d "$BUILD_DIR/classes" \
    $(find "$PATCH_DIR/src" "$BUILD_DIR/generated" -name '*.java') 2>/dev/null

log "Converting to dex and back to smali"
"$D8" --min-api 19 --no-desugaring --output "$BUILD_DIR/dex" \
    $(find "$BUILD_DIR/classes" -name '*.class')
java -cp "$(printf '%s:' "$BAKSMALI_DIR"/*.jar)" com.android.tools.smali.baksmali.Main disassemble \
    "$BUILD_DIR/dex/classes.dex" -o "$BUILD_DIR/smali-out" >/dev/null
cp -r "$BUILD_DIR/smali-out/mark" "$BUILD_DIR/src/smali/"

log "Injecting the hooks into Via"
python3 "$PATCH_DIR/tools/inject_hook.py" "$BUILD_DIR/src"

log "Building APK"
java -jar "$APKTOOL_JAR" build "$BUILD_DIR/src" -o "$BUILD_DIR/unsigned.apk"

log "Aligning and signing"
"$BUILD_TOOLS/zipalign" -p -f 4 "$BUILD_DIR/unsigned.apk" "$BUILD_DIR/aligned.apk"
"$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" \
    --ks-pass "pass:$KEY_PASSWORD" \
    --key-pass "pass:$KEY_PASSWORD" \
    --v1-signing-enabled true \
    --v2-signing-enabled true \
    --v3-signing-enabled true \
    --out "$BUILD_DIR/$APK_NAME" \
    "$BUILD_DIR/aligned.apk"
"$BUILD_TOOLS/apksigner" verify --print-certs "$BUILD_DIR/$APK_NAME" | head -5

mkdir -p "$DIST_DIR"
cp "$BUILD_DIR/$APK_NAME" "$DIST_DIR/$APK_NAME"

log "Done: dist/$APK_NAME"
