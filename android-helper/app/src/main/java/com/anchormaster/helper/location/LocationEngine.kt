package com.anchormaster.helper.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import com.anchormaster.helper.model.TelemetrySample
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

class LocationEngine(
    private val context: Context,
    private val scope: CoroutineScope,
    private val onSample: (TelemetrySample) -> Unit,
) {
    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var locationJob: Job? = null

    fun start(): Boolean {
        stop()

        return if (isLocationPermissionGranted()) {
            startHardware()
            true
        } else {
            startSynthetic()
            false
        }
    }

    fun stop() {
        runCatching { manager.removeUpdates(locationListener) }
        locationJob?.cancel()
        locationJob = null
    }

    fun isLocationPermissionGranted(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    @SuppressLint("MissingPermission")
    private fun startHardware() {
        val provider = pickBestProvider()
        if (provider == null) {
            startSynthetic()
            return
        }

        manager.requestLocationUpdates(
            provider,
            1000L,
            0f,
            locationListener,
            Looper.getMainLooper(),
        )
    }

    private fun pickBestProvider(): String? {
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)

        for (provider in providers) {
            if (!manager.isProviderEnabled(provider)) {
                continue
            }
            if (provider == LocationManager.GPS_PROVIDER ||
                provider == LocationManager.NETWORK_PROVIDER
            ) {
                return provider
            }
        }

        return if (manager.isProviderEnabled(LocationManager.PASSIVE_PROVIDER)) {
            LocationManager.PASSIVE_PROVIDER
        } else {
            null
        }
    }

    private fun startSynthetic() {
        locationJob = scope.launch {
            val baseLat = 54.3200
            val baseLon = 10.1400
            var index = 0
            while (true) {
                val now = System.currentTimeMillis()
                val lat = baseLat + sin(index / 20.0) * 0.0001
                val lon = baseLon + cos(index / 20.0) * 0.0001
                val sample = TelemetrySample(
                    ts = now,
                    lat = lat,
                    lon = lon,
                    sogKn = 0.2,
                    cogDeg = (index * 7 % 360).toDouble(),
                    headingDeg = (index * 7 % 360).toDouble(),
                    valid = true,
                )
                onSample(sample)
                index++
                delay(1_000)
            }
        }
    }

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val now = System.currentTimeMillis()
            val ageMs = now - max(location.time, 0L)
            val sample = TelemetrySample(
                ts = now,
                lat = location.latitude,
                lon = location.longitude,
                sogKn = max(location.speed * 1.943844, 0.0),
                cogDeg = normalizeAngle(location.bearing),
                headingDeg = normalizeAngle(location.bearing),
                valid = ageMs <= 5_000,
            )
            onSample(sample)
        }

        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {
            // no-op
        }

        override fun onProviderEnabled(provider: String) {
            onSample(
                TelemetrySample(
                    ts = System.currentTimeMillis(),
                    lat = 54.3200,
                    lon = 10.1400,
                    sogKn = 0.0,
                    cogDeg = 0.0,
                    headingDeg = 0.0,
                    valid = true,
                ),
            )
        }
    }

    private fun normalizeAngle(rawHeading: Float): Double {
        val value = if (rawHeading < 0f) rawHeading + 360f else rawHeading
        return value.toDouble()
    }
}
