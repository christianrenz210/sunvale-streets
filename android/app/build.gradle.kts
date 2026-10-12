plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Copies the Ionic web build (../web/dist) into the APK assets when building locally.
// On CI the workflow drops the built files straight into src/main/assets/www.
val webDist = rootProject.file("../web/dist")
val copyWebAssets by tasks.registering(Copy::class) {
    onlyIf { webDist.exists() }
    from(webDist)
    into(file("src/main/assets/www"))
}
tasks.named("preBuild") { dependsOn(copyWebAssets) }

android {
    namespace = "com.sunvale.streets"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sunvale.streets"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "1.0.0"
    }

    signingConfigs {
        create("release") {
            val store = System.getenv("SIGNING_STORE_FILE")
            if (store != null && file(store).exists()) {
                storeFile = file(store)
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Use the real release key when CI provides one, otherwise fall back to the
            // debug key so the APK is always installable.
            val release = signingConfigs.getByName("release")
            signingConfig = if (release.storeFile != null) release else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
    androidResources {
        // keep hashed web assets uncompressed-friendly and never strip the www folder
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
