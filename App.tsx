// App.tsx（ログ選択・コピー対応版）
// - Logsセクション内のTextに selectable={true} を追加
// - 小さなUI改善: log領域に背景色と角丸を付与してコピー操作しやすく

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Linking,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, Device, ScanMode, State } from "react-native-ble-plx";
import { Buffer } from "buffer";

const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1";
const TARGET_NAME_HINT = "RPi";

(global as any).Buffer = (global as any).Buffer || Buffer;

export default function App() {
  const managerRef = useRef(new BleManager());
  const [state, setState] = useState<State | "Unknown">("Unknown");
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [lastRead, setLastRead] = useState<string>("(not read yet)");

  const log = useCallback((msg: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`${stamp}: ${msg}`, ...prev].slice(0, 400));
    console.log(msg);
  }, []);

  useEffect(() => {
    const sub = managerRef.current.onStateChange((s) => {
      setState(s);
      log(`BLE state: ${s}`);
    }, true);
    return () => sub.remove();
  }, [log]);

  const ensurePermissions = useCallback(async () => {
    if (Platform.OS !== "android") return true;
    const api = Number(Platform.Version);
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        "android.permission.BLUETOOTH_SCAN" as any,
        "android.permission.BLUETOOTH_CONNECT" as any,
      ]);
      return Object.values(res).every(
        (v) => v === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const res = await PermissionsAndroid.request(
        "android.permission.ACCESS_FINE_LOCATION"
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    }
  }, []);

  const startScan = useCallback(async () => {
    if (scanning) return;
    if (state !== State.PoweredOn) {
      log("Bluetooth is not PoweredOn");
      return;
    }
    const ok = await ensurePermissions();
    if (!ok) {
      log("Permissions not granted");
      return;
    }

    setDevices({});
    setScanning(true);
    log("[SCAN] ===== StartDeviceScan() =====");

    managerRef.current.startDeviceScan(
      null,
      { scanMode: ScanMode.LowLatency },
      (error, device) => {
        if (error) {
          log(`[SCAN] ERROR: ${error.message}`);
          setScanning(false);
          return;
        }
        if (!device) return;
        const name = device.name || device.localName || "(no name)";
        const rssi = device.rssi ?? "(n/a)";
        const uuids = device.serviceUUIDs?.join(",") ?? "(none)";
        log(
          `[SCAN] FOUND: name="${name}" id=${device.id} RSSI=${rssi} UUIDs=${uuids}`
        );
        setDevices((prev) =>
          prev[device.id] ? prev : { ...prev, [device.id]: device }
        );
      }
    );
  }, [ensurePermissions, log, scanning, state]);

  const stopScan = useCallback(() => {
    if (!scanning) return;
    managerRef.current.stopDeviceScan();
    setScanning(false);
    log("[SCAN] ===== StopDeviceScan() =====");
  }, [scanning, log]);

  const connectAndRead = useCallback(
    async (dev: Device) => {
      try {
        stopScan();
        log(
          `[READ] Connecting to ${dev.name || dev.localName || "(no name)"} / ${
            dev.id
          }`
        );
        const connected = await managerRef.current.connectToDevice(dev.id);
        const d2 = await connected.discoverAllServicesAndCharacteristics();
        const ch = await d2.readCharacteristicForService(
          SERVICE_UUID,
          CHAR_UUID
        );
        const base64 = ch.value || "";
        const text = Buffer.from(base64, "base64").toString("utf8");
        setLastRead(text);
        log(`[READ] Value: ${text}`);
        await d2.cancelConnection();
        log("[READ] Disconnected");
      } catch (e: any) {
        log(`[READ] error: ${e.message}`);
      }
    },
    [log, stopScan]
  );

  const topInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;

  return (
    <>
      <StatusBar
        translucent
        barStyle="dark-content"
        backgroundColor="transparent"
      />
      <SafeAreaView style={[styles.safe, { paddingTop: topInset }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>BLE Scanner (Log Copy対応)</Text>
          <Text style={styles.sub}>State: {String(state)}</Text>

          <View style={styles.row}>
            <View style={styles.btn}>
              <Button
                title={scanning ? "Scanning..." : "Start Scan"}
                onPress={startScan}
                disabled={scanning}
              />
            </View>
            <View style={styles.btn}>
              <Button
                title="Stop Scan"
                onPress={stopScan}
                disabled={!scanning}
              />
            </View>
          </View>

          <Text style={styles.section}>
            Devices ({Object.keys(devices).length})
          </Text>
          {Object.values(devices).map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              onPress={() => connectAndRead(item)}
            >
              <Text style={styles.cardTitle}>
                {item.name || item.localName || "(no name)"}
              </Text>
              <Text style={styles.cardId}>{item.id}</Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.section}>Last Read</Text>
          <View style={styles.readBox}>
            <Text>{lastRead}</Text>
          </View>

          <Text style={styles.section}>Logs (長押しでコピー可能)</Text>
          <View style={styles.logBox}>
            {logs.map((line, idx) => (
              <Text
                key={`${idx}-${line}`}
                style={styles.log}
                selectable={true} // ← これでコピー可能になる！
              >
                {line}
              </Text>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 16, paddingBottom: 24 },
  title: { fontSize: 18, fontWeight: "600" },
  sub: { marginTop: 4, color: "#555" },
  row: { flexDirection: "row", gap: 12, marginTop: 12 },
  btn: { flex: 1 },
  section: { marginTop: 16, fontWeight: "600" },
  card: {
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 8,
    marginTop: 8,
  },
  cardTitle: { fontWeight: "600" },
  cardId: { color: "#666", marginTop: 2, fontSize: 12 },
  readBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  logBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 8,
    backgroundColor: "#fafafa",
    padding: 8,
    marginTop: 8,
  },
  log: {
    fontSize: 12,
    color: "#333",
    marginBottom: 3,
  },
});
