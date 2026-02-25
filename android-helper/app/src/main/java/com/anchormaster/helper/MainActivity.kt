package com.anchormaster.helper

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.anchormaster.helper.service.HelperService
import java.util.ArrayList
import java.util.UUID

class MainActivity : AppCompatActivity() {
    companion object {
        private const val PREF_KEY_RUNNING = "running"
        private const val PREF_KEY_LAST_LOG = "lastLog"
        private const val PREF_KEY_LAST_STATUS_TEXT = "lastStatusText"
    }

    private lateinit var editBoatId: EditText
    private lateinit var editBoatSecret: EditText
    private lateinit var editRelayBase: EditText
    private lateinit var editDeviceId: EditText
    private lateinit var tvVersion: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvLog: TextView

    private val prefs by lazy { getSharedPreferences("android-helper", Context.MODE_PRIVATE) }
    private var receiverRegistered = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val denied = result.entries.filter { !it.value }.map { it.key }
        if (denied.isNotEmpty()) {
            Toast.makeText(this, "Some permissions denied: ${denied.joinToString()}", Toast.LENGTH_LONG).show()
            if (denied.any { it.startsWith("android.permission.ACCESS") }) {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            }
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val runningFromPrefs = prefs.getBoolean(PREF_KEY_RUNNING, false)
            val running = intent?.getBooleanExtra(HelperService.EXTRA_STATUS_RUNNING, runningFromPrefs) ?: runningFromPrefs
            val text = intent?.getStringExtra(HelperService.EXTRA_STATUS_TEXT)
                ?: prefs.getString(PREF_KEY_LAST_STATUS_TEXT, "")
                ?: prefs.getString(PREF_KEY_LAST_LOG, "")
                ?: ""

            renderStatus(running, text)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        editBoatId = findViewById(R.id.editBoatId)
        editBoatSecret = findViewById(R.id.editBoatSecret)
        editRelayBase = findViewById(R.id.editRelayBase)
        editDeviceId = findViewById(R.id.editDeviceId)
        tvVersion = findViewById(R.id.tvVersion)
        tvStatus = findViewById(R.id.tvStatus)
        tvLog = findViewById(R.id.tvLog)

        tvVersion.text = getVersionText()

        findViewById<Button>(R.id.btnStart).setOnClickListener {
            if (!requestPermissionsIfNeeded()) {
                return@setOnClickListener
            }
            persistInputs()
            val startIntent = Intent(this, HelperService::class.java).apply {
                action = HelperService.ACTION_START
                putExtra(HelperService.EXTRA_BOAT_ID, editBoatId.text.toString())
                putExtra(HelperService.EXTRA_BOAT_SECRET, editBoatSecret.text.toString())
                putExtra(HelperService.EXTRA_RELAY_BASE_URL, editRelayBase.text.toString())
                putExtra(HelperService.EXTRA_DEVICE_ID, editDeviceId.text.toString())
            }
            ContextCompat.startForegroundService(this, startIntent)
            updatePreview()
            requestStatusRefresh()
        }

        findViewById<Button>(R.id.btnStop).setOnClickListener {
            startService(Intent(this, HelperService::class.java).apply {
                action = HelperService.ACTION_STOP
            })
            requestStatusRefresh()
        }

        loadSavedFields()
        updatePreview()
    }

    override fun onStart() {
        super.onStart()
        registerStatusReceiverIfNeeded()
        updatePreview()
        requestStatusRefresh()
    }

    override fun onStop() {
        unregisterStatusReceiverIfNeeded()
        super.onStop()
    }

    private fun requestPermissionsIfNeeded(): Boolean {
        val missing = collectMissingPermissions()
        if (missing.isEmpty()) {
            return true
        }
        permissionLauncher.launch(missing.toTypedArray())
        return false
    }

    private fun collectMissingPermissions(): List<String> {
        val required = ArrayList<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            required.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                required.add(Manifest.permission.BLUETOOTH_SCAN)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                required.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                required.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            required.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        return required
    }

    private fun loadSavedFields() {
        editBoatId.setText(prefs.getString("boatId", getString(R.string.default_boat_id)))
        editBoatSecret.setText(prefs.getString("boatSecret", ""))
        editRelayBase.setText(prefs.getString("relayBaseUrl", getString(R.string.default_relay_url)))
        val savedDeviceId = prefs.getString("deviceId", "android-helper")
        editDeviceId.setText(
            savedDeviceId.orEmpty().ifEmpty {
                "android-${UUID.randomUUID().toString().take(6)}"
            },
        )
    }

    private fun persistInputs() {
        val boatId = editBoatId.text.toString().trim()
        val boatSecret = editBoatSecret.text.toString().trim()
        val relayBase = editRelayBase.text.toString().trim()
        val deviceId = editDeviceId.text.toString().trim().ifEmpty {
            "android-${UUID.randomUUID().toString().take(8)}"
        }

        prefs.edit()
            .putString("boatId", boatId)
            .putString("boatSecret", boatSecret)
            .putString("relayBaseUrl", relayBase)
            .putString("deviceId", deviceId)
            .apply()

        editBoatId.setText(boatId.ifEmpty { getString(R.string.default_boat_id) })
        editBoatSecret.setText(boatSecret)
        editRelayBase.setText(relayBase.ifEmpty { getString(R.string.default_relay_url) })
        editDeviceId.setText(deviceId)
    }

    private fun registerStatusReceiverIfNeeded() {
        if (receiverRegistered) {
            return
        }

        val filter = IntentFilter(HelperService.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.registerReceiver(
                this,
                statusReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } else {
            registerReceiver(statusReceiver, filter)
        }
        receiverRegistered = true
    }

    private fun unregisterStatusReceiverIfNeeded() {
        if (!receiverRegistered) {
            return
        }

        runCatching { unregisterReceiver(statusReceiver) }
        receiverRegistered = false
    }

    private fun requestStatusRefresh() {
        startService(Intent(this, HelperService::class.java).apply {
            action = HelperService.ACTION_STATUS_REQUEST
        })
    }

    private fun updatePreview() {
        val running = prefs.getBoolean(PREF_KEY_RUNNING, false)
        val existingStatusText = prefs.getString(PREF_KEY_LAST_STATUS_TEXT, "") ?: ""
        val existingLog = prefs.getString(PREF_KEY_LAST_LOG, "") ?: ""
        val text = if (existingStatusText.isNotBlank()) existingStatusText else existingLog
        renderStatus(running, text)
    }

    private fun renderStatus(running: Boolean, text: String) {
        tvStatus.text = if (running) "Running" else "Ready"
        tvLog.text = if (text.isBlank()) {
            if (running) {
                "Waiting for service logs..."
            } else {
                "No logs yet."
            }
        } else {
            text
        }
    }

    private fun getVersionText(): String {
        return try {
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0)
            }

            val buildVersion = BuildConfig.HELPER_BUILD_VERSION
                .ifBlank { "run-unknown" }

            "Version ${packageInfo.versionName ?: "?"} ($buildVersion) [build ${packageInfo.versionCode}]"
        } catch (_: Exception) {
            getString(R.string.version_unknown)
        }
    }
}
