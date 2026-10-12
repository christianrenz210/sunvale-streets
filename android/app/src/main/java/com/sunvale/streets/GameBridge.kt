package com.sunvale.streets

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Exposed to the game as `window.SunvaleAndroid` (see web/src/game/Save.ts).
 * Methods run on a WebView binder thread, so UI work is posted to the main thread.
 */
class GameBridge(private val activity: MainActivity) {

    private val prefs = activity.getSharedPreferences("sunvale_save", Context.MODE_PRIVATE)

    private val vibrator: Vibrator? by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    @JavascriptInterface
    fun saveGame(json: String) {
        prefs.edit().putString(KEY_SAVE, json).apply()
    }

    @JavascriptInterface
    fun loadGame(): String = prefs.getString(KEY_SAVE, "") ?: ""

    @JavascriptInterface
    fun clearSave() {
        prefs.edit().remove(KEY_SAVE).apply()
    }

    @JavascriptInterface
    fun vibrate(ms: Int) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        v.vibrate(VibrationEffect.createOneShot(ms.coerceIn(1, 500).toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
    }

    @JavascriptInterface
    fun setKeepScreenOn(on: Boolean) {
        activity.runOnUiThread {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    @JavascriptInterface
    fun exitApp() {
        activity.runOnUiThread { activity.finishAndRemoveTask() }
    }

    @JavascriptInterface
    fun getPlatformInfo(): String = JSONObject()
        .put("platform", "android")
        .put("model", Build.MODEL)
        .put("sdk", Build.VERSION.SDK_INT)
        .put("appVersion", BuildConfig.VERSION_NAME)
        .toString()

    private companion object {
        const val KEY_SAVE = "save_v1"
    }
}
