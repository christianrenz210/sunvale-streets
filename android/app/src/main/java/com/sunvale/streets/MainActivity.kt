package com.sunvale.streets

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Native Kotlin host for Sunvale Streets.
 *
 * The game engine (three.js + Ionic UI) is bundled in assets/www and served through
 * [WebViewAssetLoader] from a secure https origin, so ES modules and WebGL work exactly
 * like on the web. Kotlin provides the native layer: immersive fullscreen, landscape lock,
 * hardware back button, haptics, persistent saves and lifecycle-driven pausing.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#120a1f"))
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
        }
        setContentView(webView)
        hideSystemBars()

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == ASSET_HOST) return false
                // anything outside the game opens in the browser
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(request.url.toString())))
                return true
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(GameBridge(this), "SunvaleAndroid")

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(START_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Let the game decide: close menus / pause. If it declines, leave the app.
                webView.evaluateJavascript(
                    "(function(){return window.__sunvaleBack ? window.__sunvaleBack() : false;})()"
                ) { result -> if (result != "true") finish() }
            }
        })
    }

    fun hideSystemBars() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onPause() {
        webView.evaluateJavascript("window.__sunvale && window.__sunvale.onAppPause()", null)
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.evaluateJavascript("window.__sunvale && window.__sunvale.onAppResume()", null)
        hideSystemBars()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface("SunvaleAndroid")
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://$ASSET_HOST/assets/www/index.html"
    }
}
