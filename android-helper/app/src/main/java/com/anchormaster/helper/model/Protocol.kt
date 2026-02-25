package com.anchormaster.helper.model

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

object Protocol {
    const val PROTOCOL_VERSION = "am.v1"

    const val SERVICE_UUID = "9f2d0000-87aa-4f4a-a0ea-4d5d4f415354"
    const val CHAR_CONTROL_TX_UUID = "9f2d0001-87aa-4f4a-a0ea-4d5d4f415354"
    const val CHAR_EVENT_RX_UUID = "9f2d0002-87aa-4f4a-a0ea-4d5d4f415354"
    const val CHAR_SNAPSHOT_UUID = "9f2d0003-87aa-4f4a-a0ea-4d5d4f415354"
    const val CHAR_AUTH_UUID = "9f2d0004-87aa-4f4a-a0ea-4d5d4f415354"

    fun now(): Long {
        return System.currentTimeMillis()
    }

    fun msgId32(msgId: String): Int {
        return msgId.hashCode()
    }

    fun newMsgId(): String {
        return UUID.randomUUID().toString()
    }

    fun parseEnvelope(raw: String): JSONObject? {
        return try {
            JSONObject(raw)
        } catch (_: Exception) {
            null
        }
    }

    private fun buildEnvelope(
        msgType: String,
        msgId: String,
        boatId: String,
        deviceId: String,
        seq: Int,
        requiresAck: Boolean,
        payload: JSONObject,
    ): JSONObject {
        return JSONObject().apply {
            put("ver", PROTOCOL_VERSION)
            put("msgType", msgType)
            put("msgId", msgId)
            put("boatId", boatId)
            put("deviceId", deviceId)
            put("seq", seq)
            put("ts", now())
            put("requiresAck", requiresAck)
            put("payload", payload)
        }
    }

    fun buildStatusPatch(
        seq: Int,
        boatId: String,
        deviceId: String,
        sample: TelemetrySample?,
        anchorState: String,
        anchorLat: Double?,
        anchorLon: Double?,
        bleConnected: Boolean,
        cloudConnected: Boolean,
    ): JSONObject {
        val telemetry = JSONObject()
        telemetry.put("gps", JSONObject().apply {
            put("lat", sample?.lat ?: 0.0)
            put("lon", sample?.lon ?: 0.0)
            put("valid", sample?.valid == true)
            put("ageMs", sample?.let { (now() - it.ts).coerceAtLeast(0L) } ?: 0L)
        })
        telemetry.put("motion", JSONObject().apply {
            put("sogKn", sample?.sogKn ?: 0.0)
            put("cogDeg", sample?.cogDeg ?: 0.0)
            put("headingDeg", sample?.headingDeg ?: 0.0)
        })

        val anchor = JSONObject()
        anchor.put("state", anchorState)
        if (anchorLat != null && anchorLon != null) {
            anchor.put("position", JSONObject().apply {
                put("lat", anchorLat)
                put("lon", anchorLon)
            })
        }

        val statePatch = JSONObject()
        statePatch.put("telemetry", telemetry)
        statePatch.put("anchor", anchor)
        statePatch.put("system", JSONObject().apply {
            put("ble", JSONObject().apply { put("connected", bleConnected) })
            put("cloud", JSONObject().apply {
                put("reachable", cloudConnected)
                put("role", "android-helper")
            })
        })

        return buildEnvelope(
            msgType = "status.patch",
            msgId = newMsgId(),
            boatId = boatId,
            deviceId = deviceId,
            seq = seq,
            requiresAck = false,
            payload = JSONObject().apply {
                put("statePatch", statePatch)
            },
        )
    }

    fun buildStatusSnapshot(
        seq: Int,
        boatId: String,
        deviceId: String,
        sample: TelemetrySample?,
        anchorState: String,
        anchorLat: Double?,
        anchorLon: Double?,
    ): JSONObject {
        val telemetry = JSONObject().apply {
            put("gps", JSONObject().apply {
                put("lat", sample?.lat ?: 0.0)
                put("lon", sample?.lon ?: 0.0)
                put("valid", sample?.valid == true)
                put("ageMs", sample?.let { now() - it.ts } ?: 0)
            })
            put("motion", JSONObject().apply {
                put("sogKn", sample?.sogKn ?: 0.0)
                put("cogDeg", sample?.cogDeg ?: 0.0)
                put("headingDeg", sample?.headingDeg ?: 0.0)
            })
        }

        val anchor = JSONObject().apply {
            put("state", anchorState)
            if (anchorLat != null && anchorLon != null) {
                put("position", JSONObject().apply {
                    put("lat", anchorLat)
                    put("lon", anchorLon)
                })
            }
        }

        return buildEnvelope(
            msgType = "status.snapshot",
            msgId = newMsgId(),
            boatId = boatId,
            deviceId = deviceId,
            seq = seq,
            requiresAck = false,
            payload = JSONObject().apply {
                put("snapshot", JSONObject().apply {
                    put("telemetry", telemetry)
                    put("anchor", anchor)
                    put("updatedAt", now())
                })
                put("updatedAt", now())
            },
        )
    }

    fun buildTrackSnapshot(
        seq: Int,
        boatId: String,
        deviceId: String,
        points: List<TrackPoint>,
    ): JSONObject {
        val pointArray = JSONArray()
        for (point in points) {
            pointArray.put(
                JSONObject().apply {
                    put("ts", point.ts)
                    put("lat", point.lat)
                    put("lon", point.lon)
                    put("sogKn", point.sogKn)
                    put("cogDeg", point.cogDeg)
                    put("headingDeg", point.headingDeg)
                },
            )
        }

        return buildEnvelope(
            msgType = "track.snapshot",
            msgId = newMsgId(),
            boatId = boatId,
            deviceId = deviceId,
            seq = seq,
            requiresAck = false,
            payload = JSONObject().apply {
                put("points", pointArray)
                put("totalPoints", points.size)
                put("returnedPoints", points.size)
            },
        )
    }

    fun buildCommandAck(
        seq: Int,
        boatId: String,
        deviceId: String,
        ackForMsgId: String,
        status: String,
        errorCode: String? = null,
        errorDetail: String? = null,
    ): JSONObject {
        return buildEnvelope(
            msgType = "command.ack",
            msgId = newMsgId(),
            boatId = boatId,
            deviceId = deviceId,
            seq = seq,
            requiresAck = false,
            payload = JSONObject().apply {
                put("ackForMsgId", ackForMsgId)
                put("status", status)
                put("errorCode", errorCode)
                put("errorDetail", errorDetail)
            },
        )
    }

    fun buildOnboardingBoatSecret(
        seq: Int,
        boatId: String,
        deviceId: String,
        secret: String,
    ): JSONObject {
        return buildEnvelope(
            msgType = "onboarding.boat_secret",
            msgId = newMsgId(),
            boatId = boatId,
            deviceId = deviceId,
            seq = seq,
            requiresAck = false,
            payload = JSONObject().apply {
                put("boatId", boatId)
                put("boatSecret", secret)
                put("issuedAt", now())
            },
        )
    }

    fun buildWifiScanResult(
        seq: Int,
        boatId: String,
        deviceId: String,
        requestId: String,
        completedAt: Long,
        ssids: List<MockWifiNetwork> = emptyList(),
    ): JSONObject {
        val array = JSONArray()
        for (network in ssids) {
            array.put(
                JSONObject().apply {
                    put("ssid", network.ssid)
                    put("security", network.security)
                    put("rssi", network.rssi)
                    put("channel", network.channel)
                    put("hidden", network.hidden)
                },
            )
        }

        return buildEnvelope(
            msgType = "onboarding.wifi.scan_result",
            msgId = newMsgId(),
            boatId = boatId,
            deviceId = deviceId,
            seq = seq,
            requiresAck = false,
            payload = JSONObject().apply {
                put("requestId", requestId)
                put("completedAt", completedAt)
                put("networks", array)
            },
        )
    }
}

data class TelemetrySample(
    val ts: Long,
    val lat: Double,
    val lon: Double,
    val sogKn: Double,
    val cogDeg: Double,
    val headingDeg: Double,
    val valid: Boolean,
)

data class TrackPoint(
    val ts: Long,
    val lat: Double,
    val lon: Double,
    val sogKn: Double,
    val cogDeg: Double,
    val headingDeg: Double,
)

data class MockWifiNetwork(
    val ssid: String,
    val security: String,
    val rssi: Int,
    val channel: Int,
    val hidden: Boolean,
)
