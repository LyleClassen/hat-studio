.class public final Lhatlog/L;
.super Ljava/lang/Object;
.source "L.java"

# Injected logger for reverse-engineering the Mini LedShow BLE protocol.
# Logs at ERROR level (Honor/MagicOS drops lower levels) under tag HATLOG.
# Every entry point swallows all exceptions so it can never crash the app.
# Honor/MagicOS also hides third-party logcat output entirely, so every line is
# additionally appended to <external files dir>/hatlog.txt, which can be read with
#   adb pull /sdcard/Android/data/com.led.miniled/files/hatlog.txt

.field private static out:Ljava/io/FileOutputStream;


.method public static write(Ljava/lang/String;)V
    .locals 4

    :try_start_0
    sget-object v0, Lhatlog/L;->out:Ljava/io/FileOutputStream;
    if-nez v0, :have_stream

    invoke-static {}, Landroid/app/ActivityThread;->currentApplication()Landroid/app/Application;
    move-result-object v1
    if-eqz v1, :catch_0

    const/4 v2, 0x0
    invoke-virtual {v1, v2}, Landroid/content/Context;->getExternalFilesDir(Ljava/lang/String;)Ljava/io/File;
    move-result-object v2
    if-nez v2, :have_dir
    invoke-virtual {v1}, Landroid/content/Context;->getFilesDir()Ljava/io/File;
    move-result-object v2

    :have_dir
    new-instance v3, Ljava/io/File;
    const-string v0, "hatlog.txt"
    invoke-direct {v3, v2, v0}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    new-instance v0, Ljava/io/FileOutputStream;
    const/4 v2, 0x1
    invoke-direct {v0, v3, v2}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;Z)V
    sput-object v0, Lhatlog/L;->out:Ljava/io/FileOutputStream;

    :have_stream
    new-instance v1, Ljava/lang/StringBuilder;
    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V
    invoke-static {}, Ljava/lang/System;->currentTimeMillis()J
    move-result-wide v2
    invoke-virtual {v1, v2, v3}, Ljava/lang/StringBuilder;->append(J)Ljava/lang/StringBuilder;
    const-string v2, " "
    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v1, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v2, "\n"
    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v1
    invoke-virtual {v1}, Ljava/lang/String;->getBytes()[B
    move-result-object v1
    # One unbuffered write() per line keeps lines intact across threads.
    invoke-virtual {v0, v1}, Ljava/io/FileOutputStream;->write([B)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method


.method public static hex([B)Ljava/lang/String;
    .locals 6

    if-nez p0, :cond_ok
    const-string v0, "null"
    return-object v0

    :cond_ok
    const-string v0, "0123456789abcdef"
    new-instance v1, Ljava/lang/StringBuilder;
    array-length v2, p0
    mul-int/lit8 v2, v2, 0x2
    invoke-direct {v1, v2}, Ljava/lang/StringBuilder;-><init>(I)V
    const/4 v2, 0x0

    :loop
    array-length v3, p0
    if-ge v2, v3, :done
    aget-byte v3, p0, v2
    and-int/lit16 v3, v3, 0xff
    shr-int/lit8 v4, v3, 0x4
    invoke-virtual {v0, v4}, Ljava/lang/String;->charAt(I)C
    move-result v5
    invoke-virtual {v1, v5}, Ljava/lang/StringBuilder;->append(C)Ljava/lang/StringBuilder;
    and-int/lit8 v4, v3, 0xf
    invoke-virtual {v0, v4}, Ljava/lang/String;->charAt(I)C
    move-result v5
    invoke-virtual {v1, v5}, Ljava/lang/StringBuilder;->append(C)Ljava/lang/StringBuilder;
    add-int/lit8 v2, v2, 0x1
    goto :loop

    :done
    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method


.method public static log(Ljava/lang/String;Landroid/bluetooth/BluetoothGattCharacteristic;[B)V
    .locals 3

    :try_start_0
    new-instance v0, Ljava/lang/StringBuilder;
    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V
    invoke-virtual {v0, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v1, " "
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    if-eqz p1, :cond_nouuid
    invoke-virtual {p1}, Landroid/bluetooth/BluetoothGattCharacteristic;->getUuid()Ljava/util/UUID;
    move-result-object v1
    invoke-virtual {v1}, Ljava/util/UUID;->toString()Ljava/lang/String;
    move-result-object v1
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    :cond_nouuid
    const-string v1, " len="
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const/4 v1, -0x1
    if-eqz p2, :cond_nolen
    array-length v1, p2
    :cond_nolen
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;
    const-string v1, " "
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-static {p2}, Lhatlog/L;->hex([B)Ljava/lang/String;
    move-result-object v1
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v0
    const-string v1, "HATLOG"
    invoke-static {v1, v0}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;)I
    invoke-static {v0}, Lhatlog/L;->write(Ljava/lang/String;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method


.method public static tx(Landroid/bluetooth/BluetoothGattCharacteristic;[B)V
    .locals 1
    const-string v0, "TX"
    invoke-static {v0, p0, p1}, Lhatlog/L;->log(Ljava/lang/String;Landroid/bluetooth/BluetoothGattCharacteristic;[B)V
    return-void
.end method


.method public static rx(Landroid/bluetooth/BluetoothGattCharacteristic;)V
    .locals 2

    :try_start_0
    invoke-virtual {p0}, Landroid/bluetooth/BluetoothGattCharacteristic;->getValue()[B
    move-result-object v0
    const-string v1, "RX"
    invoke-static {v1, p0, v0}, Lhatlog/L;->log(Ljava/lang/String;Landroid/bluetooth/BluetoothGattCharacteristic;[B)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method


.method public static mtu(II)V
    .locals 2

    :try_start_0
    new-instance v0, Ljava/lang/StringBuilder;
    const-string v1, "MTU "
    invoke-direct {v0, v1}, Ljava/lang/StringBuilder;-><init>(Ljava/lang/String;)V
    invoke-virtual {v0, p0}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;
    const-string v1, " status="
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0, p1}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;
    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v0
    const-string v1, "HATLOG"
    invoke-static {v1, v0}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;)I
    invoke-static {v0}, Lhatlog/L;->write(Ljava/lang/String;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method
