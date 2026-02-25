package com.anchormaster.helper.transport

import com.anchormaster.helper.model.Protocol
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

class RelayPipeClient(
    private val scope: CoroutineScope,
    private val onMessage: (JSONObject) -> Unit,
    private val onConnected: (Boolean) -> Unit,
    private val onLog: (String) -> Unit,
) {
    companion object {
        private const val TAG = "AnchorHelper-Relay"
    }
    private val okHttpClient = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var shouldConnect = false
    private var config: RelayConfig? = null

    private data class RelayConfig(
        val baseUrl: String,
        val boatId: String,
        val boatSecret: String,
        val deviceId: String,
    )

    fun isConnected(): Boolean {
        return webSocket != null
    }

    fun connect(baseUrl: String, boatId: String, boatSecret: String, deviceId: String) {
        if (baseUrl.isBlank() || boatId.isBlank() || deviceId.isBlank()) {
            onLog("Relay skipped: missing baseUrl/boatId/deviceId")
            return
        }

        config = RelayConfig(baseUrl = baseUrl, boatId = boatId, boatSecret = boatSecret, deviceId = deviceId)
        shouldConnect = true
        Log.i(TAG, "Relay connect requested baseUrl=$baseUrl boatId=$boatId deviceId=$deviceId")
        openSocket()
    }

    fun disconnect() {
        shouldConnect = false
        reconnectJob?.cancel()
        reconnectJob = null

        Log.i(TAG, "Relay disconnect requested")
        webSocket?.close(1000, "service stopped")
        webSocket = null
        onConnected(false)
    }

    fun sendEnvelope(envelope: JSONObject) {
        val socket = webSocket ?: run {
            Log.w(TAG, "Relay send skipped, no socket")
            onLog("Relay send skipped, no socket")
            return
        }
        runCatching { socket.send(envelope.toString()) }
            .onFailure {
                Log.w(TAG, "Relay send failed", it)
                onLog("Relay send failed: ${it.message}")
            }
    }

    private fun openSocket() {
        if (!shouldConnect) {
            return
        }

        if (webSocket != null) {
            return
        }

        val relayConfig = config ?: return
        val pipeUrl = buildPipeUrl(relayConfig) ?: return

        val request = Request.Builder()
            .url(pipeUrl)
            .header("User-Agent", "anchor-helper/0.1.0")
            .build()

        onLog("Relay connect: $pipeUrl")
        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                this@RelayPipeClient.webSocket = webSocket
                Log.i(TAG, "Relay connected")
                onLog("Relay connected")
                onConnected(true)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val envelope = Protocol.parseEnvelope(text)
                if (envelope != null) {
                    Log.v(TAG, "Relay inbound ${envelope.optString("msgType")} msgId=${envelope.optString("msgId")} seq=${envelope.optInt("seq")} boat=${envelope.optString("boatId")}")
                    onMessage(envelope)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val detail = response?.let { res ->
                    val body = runCatching { res.body?.string() ?: "" }.getOrDefault("")
                    if (body.isNotBlank()) {
                        "HTTP ${res.code} ${res.message} body=$body"
                    } else {
                        "HTTP ${res.code} ${res.message}"
                    }
                } ?: ""
                onLog("Relay failure: ${t.message ?: "unknown"}" + if (detail.isNotBlank()) " ($detail)" else "")
                Log.w(TAG, "Relay failure" + if (detail.isNotBlank()) " ($detail)" else "", t)
                this@RelayPipeClient.webSocket = null
                onConnected(false)
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onLog("Relay closed: $code $reason")
                Log.i(TAG, "Relay closed: $code $reason")
                this@RelayPipeClient.webSocket = null
                onConnected(false)
                scheduleReconnect()
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                onLog("Relay closing: $code $reason")
                Log.i(TAG, "Relay closing: $code $reason")
                webSocket.close(1000, "client closing")
                this@RelayPipeClient.webSocket = null
                onConnected(false)
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldConnect) {
            return
        }

        if (reconnectJob?.isActive == true) {
            return
        }

        reconnectJob = scope.launch {
            delay(1_500)
            if (!shouldConnect) {
                return@launch
            }
            openSocket()
        }
    }

    private fun buildPipeUrl(conf: RelayConfig): String? {
        return runCatching {
            val withScheme = if (conf.baseUrl.contains("://")) conf.baseUrl else "http://${conf.baseUrl}"
            val parsed = URI(withScheme)
            val authority = parsed.authority
                ?: throw IllegalArgumentException("relay URL must include host")

            val rawBasePath = parsed.path.ifBlank { "" }.trimEnd('/')
            val basePath = rawBasePath.removeSuffix("/v1/pipe")
            val pipePath = if (basePath.isEmpty()) {
                "/v1/pipe"
            } else {
                "$basePath/v1/pipe"
            }

            val queryPrefix = parsed.query?.let { it.ifBlank { "" }.plus("&") } ?: ""
            val wsScheme = when (parsed.scheme.lowercase()) {
                "https", "wss" -> "wss"
                else -> "ws"
            }

            "$wsScheme://$authority$pipePath?${queryPrefix}boatId=${enc(conf.boatId)}&boatSecret=${enc(conf.boatSecret)}&deviceId=${enc(conf.deviceId)}&role=device"
        }.getOrNull()
    }

    private fun enc(value: String): String {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    }
}
