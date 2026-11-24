/**
 * GATT UUIDs recovered from the Mini LedShow 1.3.3 Dart AOT snapshot
 * (libapp.so string pool; see docs/PROTOCOL.md).
 *
 *  - The A950 service belongs to package:miniled/ble/protocol/miniledshow/UUIDConfig.dart.
 *    Field names in the pool: uuid_server, uuid_write_1, uuid_write_2, uuid_notify.
 *  - The AE00 service is the JieLi OTA (firmware update) channel:
 *    uuid_server_ota, uuid_write_ota, uuid_notify_ota.
 *
 * Which of A951/A952/A953 is write_1/write_2/notify is confirmed from GATT
 * characteristic properties at runtime by the probe, not assumed here.
 */
const base = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`

export const LED_SERVICE = base('a950')
export const LED_CHARS = [base('a951'), base('a952'), base('a953')] as const
/** Confirmed from captured traffic: all app → hat LED commands go to A951. */
export const LED_WRITE = base('a951')
/** Confirmed from captured traffic: bulk upload data (drawings, text) goes to A952. */
export const LED_DATA = base('a952')
/** Confirmed from captured traffic: hat → app replies arrive on A953. */
export const LED_NOTIFY = base('a953')

export const OTA_SERVICE = base('ae00')
export const OTA_CHARS = [base('ae01'), base('ae02')] as const

/** Services we must declare up front: Web Bluetooth only exposes declared services. */
export const OPTIONAL_SERVICES = [LED_SERVICE, OTA_SERVICE]

/** Writing to the firmware-update channel could brick the device. */
export function isOtaUuid(uuid: string): boolean {
  const u = uuid.toLowerCase()
  return u === OTA_SERVICE || (OTA_CHARS as readonly string[]).includes(u)
}

export function shortUuid(uuid: string): string {
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(uuid)
  return m?.[1] ? m[1].toUpperCase() : uuid
}
