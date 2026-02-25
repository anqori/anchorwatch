package com.anchormaster.helper.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.anchormaster.helper.R
import com.anchormaster.helper.location.LocationEngine
import com.anchormaster.helper.model.MockWifiNetwork
import com.anchormaster.helper.model.Protocol
import com.anchormaster.helper.model.TelemetrySample
import com.anchormaster.helper.model.TrackPoint
import com.anchormaster.helper.transport.BlePeripheralController
import com.anchormaster.helper.transport.RelayPipeClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.UUID
import kotlin.math.max

class HelperService : Service() {
    companion object {
        const val ACTION_START = "com.anchormaster.helper.action.START"
        const val ACTION_STOP = "com.anchormaster.helper.action.STOP"
        const val ACTION_STATUS_REQUEST = "com.anchormaster.helper.action.STATUS_REQUEST"

        const val EXTRA_BOAT_ID = "extra_boat_id"
        const val EXTRA_BOAT_SECRET = "extra_boat_secret"
        const val EXTRA_RELAY_BASE_URL = "extra_relay_base_url"
        const val EXTRA_DEVICE_ID = "extra_device_id"

        const val ACTION_STATUS = "com.anchormaster.helper.ACTION_STATUS"
        const val EXTRA_STATUS_TEXT = "extra_status_text"
        const val EXTRA_STATUS_RUNNING = "extra_status_running"

        private const val CHANNEL_ID = "android-helper"
        private const val NOTIFICATION_ID = 2101
        private const val MAX_TRACK_POINTS = 2000
        private const val MAX_LOG_LINES = 30
        private const val MAX_SCAN_NAME_BYTES = 26

        private const val PREF_KEY_LAST_LOG = "lastLog"
        private const val PREF_KEY_LAST_STATUS_TEXT = "lastStatusText"
        private const val PREF_KEY_RUNNING = "running"
        private const val PREF_KEY_SHOULD_RUN = "shouldRun"
        private const val TAG = "AnchorHelper-Service"
    }

    enum class CommandSource {
        BLE,
        CLOUD,
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var ble: BlePeripheralController
    private lateinit var relay: RelayPipeClient
    private lateinit var locationEngine: LocationEngine

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private var running = false
    private var shouldRun = false
    private var publishJob: Job? = null
    private var seq = 1
    private var boatId = ""
    private var boatSecret = ""
    private var deviceId = ""
    private var relayBaseUrl = ""
    private var configVersion = 0
    private var anchorState = "up"
    private var anchorLat: Double? = null
    private var anchorLon: Double? = null
    private var latestSample: TelemetrySample? = null
    private var cloudConnected = false
    private var bleConnected = false

    private val trackPoints = ArrayDeque<TrackPoint>()
    private val logLines = ArrayDeque<String>()

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "HelperService onCreate")

        prefs = getSharedPreferences("android-helper", Context.MODE_PRIVATE)
        loadPersistentState()
        persistRuntimeState()

        ble = BlePeripheralController(
            context = this,
            scope = scope,
            onCommand = { envelope ->
                handleIncomingCommand(CommandSource.BLE, envelope)
            },
            onSnapshotRequest = {
                Protocol.buildStatusSnapshot(
                    seq = nextSeq(),
                    boatId = boatId,
                    deviceId = deviceId,
                    sample = latestSample,
                    anchorState = anchorState,
                    anchorLat = anchorLat,
                    anchorLon = anchorLon,
                )
            },
            onLog = { message -> appendLog("BLE: $message") },
        )

        relay = RelayPipeClient(
            scope = scope,
            onMessage = { envelope ->
                handleIncomingCommand(CommandSource.CLOUD, envelope)
            },
            onConnected = { connected ->
                cloudConnected = connected
                appendLog("Cloud: ${if (connected) "connected" else "disconnected"}")
                updateNotification("cloud: ${if (connected) "connected" else "disconnected"}")
            },
            onLog = { message -> appendLog(message) },
        )

        locationEngine = LocationEngine(this, scope) { sample ->
            latestSample = sample
            addTrackPoint(sample)
            if (trackPointCount() == 1) {
                appendLog("Location sample stream active")
            }
        }

        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        Log.i(TAG, "HelperService onStartCommand action=$action")

        when (action) {
            ACTION_START -> {
                updateFromIntent(intent)
                shouldRun = true
                savePersistentState()
                startStreaming()
            }

            ACTION_STOP -> {
                shouldRun = false
                savePersistentState()
                stopStreaming()
                stopSelf()
            }

            ACTION_STATUS_REQUEST -> {
                if (shouldRun && !running) {
                    appendLog("Status refresh detected pending run state; resuming helper")
                    startStreaming()
                }
                broadcastStatus(null)
                if (!running && !shouldRun) {
                    stopSelfResult(startId)
                }
            }

            else -> {
                if (shouldRun && !running) {
                    appendLog("Sticky restart detected; resuming helper")
                    startStreaming()
                } else {
                    broadcastStatus(null)
                    Log.w(TAG, "HelperService onStartCommand received unknown action=$action")
                    if (!running && !shouldRun && action == null) {
                        stopSelfResult(startId)
                    }
                }
            }
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.i(TAG, "HelperService onDestroy")
        stopStreaming()
        super.onDestroy()
    }

    private fun loadPersistentState() {
        boatId = prefs.getString("boatId", getString(R.string.default_boat_id)) ?: getString(R.string.default_boat_id)
        boatSecret = prefs.getString("boatSecret", "") ?: ""
        relayBaseUrl = prefs.getString("relayBaseUrl", null)
            ?.let { value ->
                if (value == "http://127.0.0.1:8787") {
                    getString(R.string.default_relay_url)
                } else {
                    value
                }
            }
            ?: getString(R.string.default_relay_url)
        deviceId = prefs.getString("deviceId", "android-helper-${UUID.randomUUID()}") ?: "android-helper"
        configVersion = prefs.getInt("configVersion", 0)
        shouldRun = prefs.getBoolean(PREF_KEY_SHOULD_RUN, false)
    }

    private fun savePersistentState() {
        prefs.edit()
            .putString("boatId", boatId)
            .putString("boatSecret", boatSecret)
            .putString("relayBaseUrl", relayBaseUrl)
            .putString("deviceId", deviceId)
            .putInt("configVersion", configVersion)
            .putBoolean(PREF_KEY_SHOULD_RUN, shouldRun)
            .apply()
    }

    private fun persistRuntimeState() {
        prefs.edit()
            .putBoolean(PREF_KEY_RUNNING, running)
            .apply()
    }

    private fun updateFromIntent(intent: Intent) {
        boatId = intent.getStringExtra(EXTRA_BOAT_ID)?.ifBlank { null } ?: boatId
        boatSecret = intent.getStringExtra(EXTRA_BOAT_SECRET)?.ifBlank { null } ?: boatSecret
        relayBaseUrl = intent.getStringExtra(EXTRA_RELAY_BASE_URL)?.ifBlank { null } ?: relayBaseUrl
        deviceId = intent.getStringExtra(EXTRA_DEVICE_ID)?.ifBlank { null } ?: deviceId

        if (boatSecret.isBlank()) {
            boatSecret = "am_bs_${UUID.randomUUID().toString().replace("-", "").take(24)}"
        }

        savePersistentState()
        appendLog("Configured boatId=$boatId deviceId=$deviceId relay=$relayBaseUrl")
    }

    private fun startStreaming() {
        if (running) {
            appendLog("Restart requested")
            stopStreaming()
        }

        running = true
        shouldRun = true
        Log.i(TAG, "startStreaming()")
        savePersistentState()
        persistRuntimeState()

        startForeground(NOTIFICATION_ID, buildNotification("starting"))

        locationEngine.start()
        val preferredName = "Anqori-AnchorWatch-${deviceId}"
        val maxFullName = if (preferredName.toByteArray(Charsets.UTF_8).size <= MAX_SCAN_NAME_BYTES) {
            preferredName
        } else {
            deviceId
        }
        val advertisedName = maxFullName
        val bleStarted = ble.start(advertisedName)
        if (!bleStarted) {
            appendLog("BLE failed to start")
        } else {
            appendLog("BLE started: advertising=${ble.isAdvertising()}")
        }

        if (relayBaseUrl.isNotBlank()) {
            relay.connect(relayBaseUrl, boatId, boatSecret, deviceId)
        }

        publishJob = scope.launch {
            while (running) {
                emitStatusPatch()
                delay(1_000)
            }
        }

        updateNotification("running")
        appendLog("Helper started")
    }

    private fun stopStreaming() {
        if (!running) {
            persistRuntimeState()
            return
        }

        running = false
        Log.i(TAG, "stopStreaming()")
        locationEngine.stop()
        publishJob?.cancel()
        publishJob = null
        ble.stop()
        relay.disconnect()

        stopForeground(true)

        persistRuntimeState()
        updateNotification("stopped")
        appendLog("Helper stopped")
    }

    private fun emitStatusPatch() {
        if (!running) {
            return
        }

        val sample = latestSample ?: return

        val envelope = Protocol.buildStatusPatch(
            seq = nextSeq(),
            boatId = boatId,
            deviceId = deviceId,
            sample = sample,
            anchorState = anchorState,
            anchorLat = anchorLat,
            anchorLon = anchorLon,
            bleConnected = ble.isConnected(),
            cloudConnected = relay.isConnected(),
        )

        bleConnected = ble.isConnected()

        ble.sendEventEnvelope(envelope)
        if (relay.isConnected()) {
            relay.sendEnvelope(envelope)
        }

        updateNotification("running | seq=${seq - 1} samples=${trackPointCount()}")
    }

    private fun handleIncomingCommand(source: CommandSource, envelope: JSONObject) {
        val msgType = envelope.optString("msgType")
        val requiresAck = envelope.optBoolean("requiresAck", false)
        val msgId = envelope.optString("msgId")
        val payload = envelope.optJSONObject("payload") ?: JSONObject()

        when (msgType) {
            "onboarding.request_secret" -> {
                if (boatSecret.isBlank()) {
                    boatSecret = "am_bs_${UUID.randomUUID().toString().replace("-", "").take(24)}"
                    savePersistentState()
                }
                sendToSource(
                    source,
                    Protocol.buildOnboardingBoatSecret(
                        seq = nextSeq(),
                        boatId = boatId,
                        deviceId = deviceId,
                        secret = boatSecret,
                    ),
                )
                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "config.patch" -> {
                val requestedVersion = payload.optInt("version", configVersion)
                if (requestedVersion >= configVersion) {
                    configVersion = requestedVersion
                    appendLog("Applied config patch version=$configVersion")
                    savePersistentState()
                }

                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "anchor.down" -> {
                val lat = payload.optDouble("lat", Double.NaN)
                val lon = payload.optDouble("lon", Double.NaN)
                if (!lat.isNaN() && !lon.isNaN()) {
                    anchorState = "down"
                    anchorLat = lat
                    anchorLon = lon
                    appendLog("Anchor set at $lat,$lon")
                }

                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "anchor.rise" -> {
                anchorState = "up"
                anchorLat = null
                anchorLon = null
                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "track.snapshot.request" -> {
                val points = requestTrackPayload(payload)
                sendToSource(
                    source,
                    Protocol.buildTrackSnapshot(
                        seq = nextSeq(),
                        boatId = boatId,
                        deviceId = deviceId,
                        points = points,
                    ),
                )

                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "status.snapshot.request" -> {
                sendToSource(
                    source,
                    Protocol.buildStatusSnapshot(
                        seq = nextSeq(),
                        boatId = boatId,
                        deviceId = deviceId,
                        sample = latestSample,
                        anchorState = anchorState,
                        anchorLat = anchorLat,
                        anchorLon = anchorLon,
                    ),
                )

                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "onboarding.wifi.scan" -> {
                val requestId = payload.optString("requestId", msgId)
                val networks = listOf(
                    MockWifiNetwork(
                        ssid = "AnchorDeck",
                        security = "wpa2",
                        rssi = -44,
                        channel = 6,
                        hidden = false,
                    ),
                    MockWifiNetwork(
                        ssid = "BoatGuest",
                        security = "open",
                        rssi = -68,
                        channel = 11,
                        hidden = false,
                    ),
                )

                sendToSource(
                    source,
                    Protocol.buildWifiScanResult(
                        seq = nextSeq(),
                        boatId = boatId,
                        deviceId = deviceId,
                        requestId = requestId,
                        completedAt = Protocol.now(),
                        ssids = networks,
                    ),
                )

                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "alarm.silence.request" -> {
                if (requiresAck) {
                    sendAck(source, msgId, "ok", null, null)
                }
            }

            "auth.write" -> {
                appendLog("Received auth command")
            }

            else -> {
                if (msgType.isNotBlank() && requiresAck) {
                    sendAck(source, msgId, "rejected", "UNSUPPORTED_MSG_TYPE", "$msgType")
                } else {
                    appendLog("Ignored unknown msgType=$msgType")
                }
            }
        }

        if (seq > Int.MAX_VALUE - 100) {
            seq = 1
        }
    }

    private fun requestTrackPayload(payload: JSONObject): List<TrackPoint> {
        val sinceTs = payload.optLong("sinceTs", Long.MIN_VALUE)
        val limit = max(1, payload.optInt("limit", 500))

        return synchronized(trackPoints) {
            val selected = if (sinceTs == Long.MIN_VALUE) {
                trackPoints.toList()
            } else {
                trackPoints.filter { it.ts >= sinceTs }
            }
            if (selected.size <= limit) {
                selected
            } else {
                selected.takeLast(limit)
            }
        }
    }

    private fun sendToSource(source: CommandSource, envelope: JSONObject) {
        when (source) {
            CommandSource.BLE -> ble.sendEventEnvelope(envelope)
            CommandSource.CLOUD -> relay.sendEnvelope(envelope)
        }
    }

    private fun sendAck(
        source: CommandSource,
        ackForMsgId: String,
        status: String,
        errorCode: String?,
        errorDetail: String?,
    ) {
        if (ackForMsgId.isBlank()) {
            return
        }

        val ack = Protocol.buildCommandAck(
            seq = nextSeq(),
            boatId = boatId,
            deviceId = deviceId,
            ackForMsgId = ackForMsgId,
            status = status,
            errorCode = errorCode,
            errorDetail = errorDetail,
        )
        sendToSource(source, ack)
    }

    private fun addTrackPoint(sample: TelemetrySample) {
        synchronized(trackPoints) {
            trackPoints.addLast(
                TrackPoint(
                    ts = sample.ts,
                    lat = sample.lat,
                    lon = sample.lon,
                    sogKn = sample.sogKn,
                    cogDeg = sample.cogDeg,
                    headingDeg = sample.headingDeg,
                ),
            )

            while (trackPoints.size > MAX_TRACK_POINTS) {
                trackPoints.removeFirst()
            }
        }
    }

    private fun trackPointCount(): Int = synchronized(trackPoints) { trackPoints.size }

    private fun appendLog(line: String) {
        val entry = "${Protocol.now()} $line"
        synchronized(logLines) {
            if (logLines.size >= MAX_LOG_LINES) {
                logLines.removeFirst()
            }
            logLines.addLast(entry)
        }

        prefs.edit().putString(PREF_KEY_LAST_LOG, buildDebugLog()).apply()

        updateNotification(line)
        broadcastStatus(line)
    }

    private fun updateNotification(statusLine: String) {
        if (running) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIFICATION_ID, buildNotification("$statusLine | cloud=${cloudConnected} ble=${bleConnected}"))
        }
    }

    private fun buildNotification(statusText: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setWhen(System.currentTimeMillis())
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(buildStatusBody()),
            )
            .build()
    }

    private fun buildStatusBody(): String {
        return buildString {
            append("boatId=$boatId\n")
            append("deviceId=$deviceId\n")
            append("anchor=$anchorState")
            if (anchorLat != null && anchorLon != null) {
                append(" (${anchorLat}, ${anchorLon})")
            }
            append("\n")
            append("seq=$seq\n")
            append("running=$running\n")
            append("cloud=${if (cloudConnected) "on" else "off"}, ble=${if (ble.isConnected()) "on" else "off"}\n")
            append("samples=${trackPointCount()}\n")
            append("lastLog=${latestLogLine() ?: "-"}")
        }
    }

    private fun broadcastStatus(line: String?) {
        val debugLog = buildDebugLog().trim()
        val statusText = when {
            line != null && debugLog.isNotBlank() -> "$line\n$debugLog"
            line != null -> line
            debugLog.isNotBlank() -> debugLog
            else -> buildStatusBody()
        }

        prefs.edit()
            .putString(PREF_KEY_LAST_STATUS_TEXT, statusText)
            .apply()

        val statusIntent = Intent(ACTION_STATUS).apply {
            setPackage(packageName)
            putExtra(EXTRA_STATUS_RUNNING, running)
            putExtra(EXTRA_STATUS_TEXT, statusText)
        }
        sendBroadcast(statusIntent)
    }

    private fun buildDebugLog(): String {
        val builder = StringBuilder()
        synchronized(logLines) {
            for (entry in logLines) {
                builder.appendLine(entry)
            }
        }
        return builder.toString()
    }

    private fun latestLogLine(): String? = synchronized(logLines) {
        logLines.lastOrNull()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.service_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.service_channel_desc)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun nextSeq(): Int {
        val current = seq
        seq += 1
        return current
    }
}
