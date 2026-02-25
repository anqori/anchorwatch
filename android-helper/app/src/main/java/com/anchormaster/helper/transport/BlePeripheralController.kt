package com.anchormaster.helper.transport

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import com.anchormaster.helper.model.Protocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.min

class BlePeripheralController(
    private val context: Context,
    private val scope: CoroutineScope,
    private val onCommand: (JSONObject) -> Unit,
    private val onSnapshotRequest: () -> JSONObject,
    private val onLog: (String) -> Unit,
) {
    companion object {
        private const val TAG = "AnchorHelper-BLE"
        private const val MAX_SCAN_NAME_BYTES = 26
    }
    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter = bluetoothManager.adapter
    private val advertiser = bluetoothAdapter.bluetoothLeAdvertiser

    private var gattServer: BluetoothGattServer? = null
    private var eventCharacteristic: BluetoothGattCharacteristic? = null
    private var controlCharacteristic: BluetoothGattCharacteristic? = null
    private var snapshotCharacteristic: BluetoothGattCharacteristic? = null
    private var authCharacteristic: BluetoothGattCharacteristic? = null
    private val subscribedDevices = mutableSetOf<BluetoothDevice>()
    private val pendingInbound = ConcurrentHashMap<Int, InboundAssembly>()
    private var cleanupJob: Job? = null
    private var serviceRunning = false
    private var connected = false
    private var lastAdvertising = false

    private data class InboundAssembly(
        val partCount: Int,
        val receivedAt: Long,
        val chunks: Array<ByteArray?>,
    )

    fun isRunning(): Boolean = serviceRunning

    fun isConnected(): Boolean = connected

    fun isAdvertising(): Boolean = lastAdvertising

    @SuppressLint("MissingPermission")
    fun start(advertisedDeviceName: String): Boolean {
        if (!hasPermissions()) {
            onLog("BLE permissions missing")
            return false
        }

        if (!bluetoothAdapter.isEnabled) {
            onLog("Bluetooth is off")
            return false
        }

        if (advertiser == null) {
            onLog("BLE advertiser unavailable")
            return false
        }

        if (subscribedDevices.size > 0 || pendingInbound.isNotEmpty()) {
            onLog("Resetting stale BLE state")
        }

        Log.d(TAG, "Starting BLE peripheral: name=$advertisedDeviceName service=${Protocol.SERVICE_UUID}")


        subscribedDevices.clear()
        pendingInbound.clear()

        val gatt = bluetoothManager.openGattServer(context, gattCallback)
        if (gatt == null) {
            onLog("BLE GATT server unavailable")
            return false
        }
        gattServer = gatt
        Log.d(TAG, "GATT server opened")

        val service = BluetoothGattService(
            UUID.fromString(Protocol.SERVICE_UUID),
            BluetoothGattService.SERVICE_TYPE_PRIMARY,
        )

        eventCharacteristic = BluetoothGattCharacteristic(
            UUID.fromString(Protocol.CHAR_EVENT_RX_UUID),
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ,
        ).also { characteristic ->
            val descriptor = BluetoothGattDescriptor(
                UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
            )
            characteristic.addDescriptor(descriptor)
            service.addCharacteristic(characteristic)
        }

        controlCharacteristic = BluetoothGattCharacteristic(
            UUID.fromString(Protocol.CHAR_CONTROL_TX_UUID),
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        ).also { service.addCharacteristic(it) }

        snapshotCharacteristic = BluetoothGattCharacteristic(
            UUID.fromString(Protocol.CHAR_SNAPSHOT_UUID),
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ,
        ).also { service.addCharacteristic(it) }

        authCharacteristic = BluetoothGattCharacteristic(
            UUID.fromString(Protocol.CHAR_AUTH_UUID),
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE,
        ).also { service.addCharacteristic(it) }

        val added = gatt.addService(service)
        Log.d(TAG, "GATT service added=${added} uuid=${Protocol.SERVICE_UUID}")
        serviceRunning = true
        connected = false

        cleanupJob = scope.launch {
            while (true) {
                cleanupIncomplete()
                delay(750)
            }
        }

        val advertisedName = sanitizeAdvertisedName(advertisedDeviceName)
        if (advertisedName != advertisedDeviceName) {
            onLog(
                "BLE advertised name sanitized: requested='$advertisedDeviceName'" +
                    " sanitized='$advertisedName' (${advertisedName.toByteArray(Charsets.UTF_8).size}/" +
                    "$MAX_SCAN_NAME_BYTES bytes)",
            )
        }
        runCatching {
            bluetoothAdapter.name = advertisedName
            Log.d(TAG, "Set Bluetooth adapter name to '$advertisedName'")
        }.onFailure { error ->
            Log.w(TAG, "Failed to update adapter name", error)
            onLog("BLE warning: failed to set Bluetooth name (${error.message ?: "unknown"})")
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .build()

        val advertiseData = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(UUID.fromString(Protocol.SERVICE_UUID)))
            .build()
        val scanData = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()

        try {
            advertiser.startAdvertising(settings, advertiseData, scanData, advertiseCallback)
            Log.d(TAG, "Advertise request submitted")
        } catch (error: SecurityException) {
            onLog("BLE advertising error: ${error.message ?: "security"}")
            Log.e(TAG, "Advertise request exception", error)
            lastAdvertising = false
            serviceRunning = false
            gattServer?.close()
            gattServer = null
            return false
        } catch (error: Exception) {
            onLog("BLE advertising error: ${error.message ?: "unknown"}")
            Log.e(TAG, "Advertise request exception", error)
            lastAdvertising = false
            serviceRunning = false
            gattServer?.close()
            gattServer = null
            return false
        }

        return true
    }

    @SuppressLint("MissingPermission")
    fun stop() {
        cleanupJob?.cancel()
        cleanupJob = null

        advertiser?.stopAdvertising(advertiseCallback)
        lastAdvertising = false

        gattServer?.close()
        gattServer = null
        serviceRunning = false
        connected = false
        subscribedDevices.clear()
        pendingInbound.clear()
        Log.d(TAG, "BLE stop requested")
    }

    @SuppressLint("MissingPermission")
    fun sendEventEnvelope(payload: JSONObject): Boolean {
        val clients = synchronized(subscribedDevices) { subscribedDevices.toList() }
        if (clients.isEmpty()) {
            return false
        }

        val raw = payload.toString().toByteArray(Charsets.UTF_8)
        val msgId = Protocol.msgId32(Protocol.newMsgId())
        val maxChunk = 16
        val partCount = maxOf(1, (raw.size + maxChunk - 1) / maxChunk)

        for (partIndex in 0 until partCount) {
            val start = partIndex * maxChunk
            val end = min(start + maxChunk, raw.size)
            val payloadPart = raw.copyOfRange(start, end)

            val frame = ByteArray(payloadPart.size + 6)
            val buffer = ByteBuffer.wrap(frame)
            buffer.putInt(msgId)
            buffer.put(partIndex.toByte())
            buffer.put(partCount.toByte())
            buffer.put(payloadPart)

            eventCharacteristic?.value = frame
            for (device in clients) {
                runCatching {
                    gattServer?.notifyCharacteristicChanged(device, eventCharacteristic, false)
                }
            }
        }

        return true
    }

    @SuppressLint("MissingPermission")
    private val gattCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val deviceLabel = runCatching { device.address }.getOrNull() ?: "unknown"
            Log.d(TAG, "Connection state device=$deviceLabel status=$status newState=$newState")
            connected = newState == BluetoothProfile.STATE_CONNECTED
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                subscribedDevices.remove(device)
                onLog("BLE central disconnected: $deviceLabel")
            } else if (newState == BluetoothProfile.STATE_CONNECTED) {
                onLog("BLE central connected: $deviceLabel")
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            val valueSize = value?.size ?: 0
            Log.d(
                TAG,
                "Write request uuid=${characteristic.uuid} prepared=$preparedWrite responseNeeded=$responseNeeded offset=$offset size=$valueSize",
            )
            when (characteristic.uuid.toString()) {
                Protocol.CHAR_CONTROL_TX_UUID -> {
                    handleControlPayload(value)
                }

                Protocol.CHAR_AUTH_UUID -> {
                    // permissive auth ack path for first version
                    onLog("Auth write request from ${runCatching { device.address }.getOrNull() ?: "unknown"}")
                }
                else -> {
                    onLog("Unhandled write request uuid=${characteristic.uuid}")
                }
            }

            if (responseNeeded) {
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    0,
                    value,
                )
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic,
        ) {
            val deviceLabel = runCatching { device.address }.getOrNull() ?: "unknown"
            Log.d(TAG, "Read request uuid=${characteristic.uuid} offset=$offset device=$deviceLabel")
            if (characteristic.uuid.toString() == Protocol.CHAR_SNAPSHOT_UUID) {
                val snapshot = onSnapshotRequest()
                val payload = snapshot.toString().toByteArray(Charsets.UTF_8)
                if (offset >= payload.size) {
                    gattServer?.sendResponse(
                        device,
                        requestId,
                        BluetoothGatt.GATT_SUCCESS,
                        payload.size,
                        ByteArray(0),
                    )
                    return
                }
                val sliceStart = offset.coerceAtLeast(0)
                val sliceEnd = payload.size
                onLog("Snapshot read requested (bytes=${payload.size}) from $deviceLabel")
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    0,
                    payload.copyOfRange(sliceStart, sliceEnd),
                )
                return
            }

            gattServer?.sendResponse(
                device,
                requestId,
                BluetoothGatt.GATT_SUCCESS,
                0,
                ByteArray(0),
            )
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            val deviceLabel = runCatching { device.address }.getOrNull() ?: "unknown"
            Log.d(
                TAG,
                "Descriptor write uuid=${descriptor.uuid} prepared=$preparedWrite responseNeeded=$responseNeeded offset=$offset size=${value?.size ?: 0} device=$deviceLabel",
            )
            if (descriptor.uuid.toString().lowercase() == "00002902-0000-1000-8000-00805f9b34fb") {
                if (value != null && value.isNotEmpty() && (value[0].toInt() and 1) != 0) {
                    subscribedDevices.add(device)
                    onLog("BLE notify subscribe: $deviceLabel")
                } else {
                    subscribedDevices.remove(device)
                    onLog("BLE notify unsubscribe: $deviceLabel")
                }
            } else {
                onLog("Descriptor write ignored: ${descriptor.uuid}")
            }

            if (responseNeeded) {
                gattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    0,
                    value,
                )
            }
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            lastAdvertising = true
            onLog("BLE advertising started")
            Log.d(
                TAG,
                "Advertise started mode=${settingsInEffect?.mode} " +
                    "tx=${settingsInEffect?.txPowerLevel} timeout=${settingsInEffect?.timeout}",
            )
        }

        override fun onStartFailure(errorCode: Int) {
            lastAdvertising = false
            val reason = when (errorCode) {
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "data too large"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "too many advertisers"
                ADVERTISE_FAILED_ALREADY_STARTED -> "already started"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "internal"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "feature unsupported"
                else -> "unknown"
            }
            lastAdvertising = false
            serviceRunning = false
            gattServer?.close()
            gattServer = null
            onLog("BLE advertising failed: $errorCode ($reason)")
            Log.e(TAG, "Advertise failed: code=$errorCode reason=$reason")
        }
    }

    private fun handleControlPayload(raw: ByteArray?) {
        if (raw == null || raw.isEmpty()) {
            return
        }

        if (raw.size >= 6) {
            val buffer = ByteBuffer.wrap(raw)
            val msgId = buffer.int
            val partIndex = buffer.get().toInt() and 0xFF
            val partCount = buffer.get().toInt() and 0xFF
            if (partCount > 0 && partIndex < partCount) {
                val payload = ByteArray(raw.size - 6)
                buffer.get(payload)
                enqueueChunk(msgId, partIndex, partCount, payload)
                return
            }
        }

        runCatching {
            JSONObject(String(raw, Charsets.UTF_8)).also { onCommand(it) }
        }.onSuccess {
            onLog("BLE control raw JSON command parsed")
        }.onFailure { error ->
            onLog("BLE control parse failed: ${error.message ?: "bad payload"}")
            Log.w(TAG, "Failed to parse BLE control payload", error)
        }
    }

    private fun enqueueChunk(msgId: Int, partIndex: Int, partCount: Int, payload: ByteArray) {
        val assembly = pendingInbound.getOrPut(msgId) {
            InboundAssembly(partCount, System.currentTimeMillis(), arrayOfNulls(partCount))
        }

        val copy = assembly.chunks.copyOf()
        if (partIndex in copy.indices) {
            copy[partIndex] = payload
        }

        if (copy.all { it != null }) {
            var total = 0
            for (part in copy) {
                if (part != null) {
                    total += part.size
                }
            }
            val merged = ByteArray(total)
            var pos = 0
            for (part in copy.filterNotNull()) {
                System.arraycopy(part, 0, merged, pos, part.size)
                pos += part.size
            }
            pendingInbound.remove(msgId)
            val raw = String(merged, Charsets.UTF_8)

            runCatching {
                JSONObject(raw)
            }
                .onSuccess { envelope ->
                    onLog("BLE control chunked envelope parsed")
                    onCommand(envelope)
                }
                .onFailure { error ->
                    onLog("BLE chunked parse failed: ${error.message ?: "bad payload"}")
                    Log.w(TAG, "Failed chunked BLE JSON", error)
                }

            return
        }

        pendingInbound[msgId] = assembly.copy(chunks = copy, receivedAt = System.currentTimeMillis())
    }

    private fun cleanupIncomplete() {
        val now = System.currentTimeMillis()
        val stale = pendingInbound.entries.filter { now - it.value.receivedAt > 2_000 }.map { it.key }
        for (key in stale) {
            pendingInbound.remove(key)
        }
    }

    private fun sanitizeAdvertisedName(name: String): String {
        val trimmed = name.ifBlank { "Anqori-AnchorWatch" }

        var sanitized = trimmed
        while (sanitized.toByteArray(Charsets.UTF_8).size > MAX_SCAN_NAME_BYTES) {
            sanitized = sanitized.dropLast(1)
        }

        return sanitized.ifEmpty { "Anchor" }
    }

    private fun hasPermissions(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true
        }

        val scanOk = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.BLUETOOTH_SCAN,
        ) == PackageManager.PERMISSION_GRANTED
        val advertiseOk = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.BLUETOOTH_ADVERTISE,
        ) == PackageManager.PERMISSION_GRANTED
        val connectOk = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.BLUETOOTH_CONNECT,
        ) == PackageManager.PERMISSION_GRANTED
        return scanOk && advertiseOk && connectOk
    }
}
