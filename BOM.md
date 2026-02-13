# Anqori AnchorWatch BOM (Berrybase-first)

Last checked: 2026-02-12  
Currency: EUR (incl. VAT, excl. shipping)  
Target: 1 device, ESP32-S3 + CAN (NMEA2000 listener) + WLAN + local alarm, Grove plug-and-play style.

## 1) Core BOM (recommended prototype set)

| Qty | Part | Why | Unit price | Link |
| ---: | --- | --- | ---: | --- |
| 1 | M5Stack AtomS3 Lite ESP32S3 Dev Kit (M5-C124) | Main MCU, Wi-Fi + BLE, compact form factor | 11.90 | https://www.berrybase.de/m5stack-atoms3-lite-esp32s3-dev-kit |
| 1 | M5Stack ATOMIC CAN Base (M5-A103) | CAN transceiver base for Atom series (isolation + CAN interface) | 9.40 | https://www.berrybase.de/m5stack-atomic-can-base-ca-is3050g-1mbps-dc-dc-isolation-kompatibel-mit-atom-serie |
| 1 | M5Stack 2-Channel SPST Relay Unit (M5-U131) | Switches external alarm load safely (use one channel now, keep one spare) | 7.50 | https://www.berrybase.de/m5stack-2-channel-spst-relay-unit |
| 1 | Piezo Signalgeber 3-24V, 100dB (SG32D41K28) | Local loud alarm output (direct 12V-capable piezo) | 3.50 | https://www.berrybase.de/piezo-signalgeber-oe41-5mm-3-24v-dc-2-8khz-100db |
| 1 | Netzteilmodul 9-36V -> 5V/5A (REG5V5A) | 12V boat power down to 5V rail for electronics | 5.20 | https://www.berrybase.de/netzteilmodul-9-36v-5v-5a-mit-usb-ausgang-und-schraubklemmen |
| 1 | Seeed Grove 4-pin cable, 50cm, 5-pack (SE-110990038) | Grove wiring between Atom and relay/unit | 2.90 | https://www.berrybase.de/seeed-grove-universal-4-pin-kabel-fixierend-50cm-5er-pack |
| 2 | WAGO 221-413, 3-fach (W221-413-1) | Fast, robust field wiring joints | 0.50 | https://www.berrybase.de/wago-221-413-verbindungsklemme-3-fach |
| 1 | Abzweigdose IP68, 1 in / 1 out (T1300606) | Weather-protected cable junction for deck/cockpit routing | 2.60 | https://www.berrybase.de/abzweigdose-ip68-fuer-aussen-1-ein-und-1-ausgang-124x45x32mm |

Estimated subtotal (core): **44.00 EUR**

## 2) Optional / useful add-ons

| Qty | Part | Why | Unit price | Link |
| ---: | --- | --- | ---: | --- |
| 1 | M5Stack ATOMIC DIY Proto Kit (M5-A077) | Fast custom breakout/proto for extra IO filtering/protection | 4.30 | https://www.berrybase.de/m5stack-atomic-diy-proto-kit-fuer-atom |
| 1 | Wasserfestes Gehäuse IP66, 220x170x110 | Off-the-shelf enclosure alternative before final STL case | 36.20 | https://www.berrybase.de/wasserfeste-plastik-gehaeuse-ip66-220mm-x-170mm-x-110mm |

## 3) Marine integration parts (important note)

For a true NMEA2000 installation you also need marine-bus items (typically Micro-C / DeviceNet backbone accessories):

1. NMEA2000 T-connector(s)
2. NMEA2000 drop cable
3. correct backbone termination/power state verification
4. ideally inline fuse + marine-grade wiring practice

I did **not** find clear NMEA2000 backbone products on Berrybase during this pass, so these are typically sourced from marine suppliers.

## 4) Build variant recommendation

For your current scope ("anchor alarm on steroids", Grove-friendly, small device), I recommend:

1. Start with **Core BOM** above (Berrybase-only practical set).
2. Use relay + piezo as local alarm in v1.
3. Keep STL case custom around:
   - AtomS3 Lite + ATOMIC CAN base stack
   - relay wiring terminals
   - power module
   - cable strain relief and splash protection features

## 5) Reichelt link check (2026-02-12)

Status legend:

- `exact` = same or equivalent item found at Reichelt
- `alt` = alternative found, but not same form-factor/part
- `missing` = no useful direct Reichelt hit found for this part number

| BOM part | Reichelt status | Reichelt link | Notes |
| --- | --- | --- | --- |
| M5Stack AtomS3 Lite (M5-C124) | exact | https://www.reichelt.de/de/de/shop/produkt/atoms3_lite_esp32s3_entwicklungskit-406498 | 10,90 EUR; listing shows expected availability from 2026-02-21. |
| M5Stack ATOMIC CAN Base (M5-A103) | missing | https://www.reichelt.de/de/de/shop/hersteller/M5STACK | Could not find A103 in current Reichelt catalog search. |
| CAN fallback (non-Atom/Grove-specific) | alt | https://www.reichelt.de/de/de/shop/produkt/arduino_shield_-_can-bus_v2_mcp2515_mcp2551-247102 | Electrical CAN option, but not plug-play with AtomS3 stack. |
| M5Stack 2-Channel SPST Relay Unit (M5-U131) | missing | https://www.reichelt.de/de/de/shop/suche/ergebnis.html?ACTION=446&q=M5-U131 | No direct Reichelt hit for M5-U131 in current search. |
| Relay fallback | alt | https://www.reichelt.de/de/de/shop/produkt/entwicklerboards_-_relais-modul_1_channel_5_v_high_low-399462 | 1-channel 5V relay module; different mechanical interface. |
| Piezo Signalgeber 3-24V, 100dB | alt | https://www.reichelt.de/de/de/shop/produkt/piezo-sirene_100db_1500_3500_hz_12_v-360889 | Very close in loudness (100 dB), but fixed 12V siren. |
| DC/DC 9-36V -> 5V | alt | https://www.reichelt.com/de/en/shop/product/dc-dc_step_down_converter_10_-_40_v_ip64-335699 | 10-40V in, 5V out, up to 6A, IP64. |
| Grove 4-pin cable 50cm (110990038) | exact | https://www.reichelt.com/de/en/arduino-grove-universal-cable-4-pin-50cm-buckled-5er-bag--grv-cable4pin50f-p191171.html | Exact Seeed cable set. |
| WAGO 221-413 | exact | https://www.reichelt.com/ch/de/shop/produkt/verbindungsklemme_3-leiteranschluss-149799 | Exact clamp series available. |
| Abzweigdose IP68 1 in / 1 out | alt | https://www.reichelt.de/de/de/shop/produkt/abzweigdose_167_x_125_x_82_mm-263007 | Reichelt has robust IP66 junction boxes; exact 1-in/1-out form not matched. |
| Optional: IP66 enclosure ~220x170x110 | alt | https://www.reichelt.de/de/de/shop/produkt/kunststoffgehaeuse_220_x_170_x_110_mm-348354 | Similar size/weather class to optional enclosure target. |
