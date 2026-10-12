# Keep the JavaScript bridge methods callable from the WebView.
-keepclassmembers class com.sunvale.streets.GameBridge {
    @android.webkit.JavascriptInterface <methods>;
}
