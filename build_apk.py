#!/usr/bin/env python3
"""
Chain Reaction APK Builder
Compiles resources, Java sources, converts bytecode with D8, 
4-byte zip-aligns, and signs with APK Signature Scheme v1, v2, and v3!
Automatically bootstraps missing tools if run on a fresh clone.
"""

import os
import subprocess
import shutil
import zipfile
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.join(BASE_DIR, 'tools')
JDK_BIN = os.path.join(TOOLS_DIR, 'jdk', 'bin')
ANDROID_DIR = os.path.join(TOOLS_DIR, 'android')

JAVA = os.path.join(JDK_BIN, 'java.exe')
JAVAC = os.path.join(JDK_BIN, 'javac.exe')
UBER_SIGNER = os.path.join(ANDROID_DIR, 'uber-apk-signer.jar')

AAPT2 = os.path.join(ANDROID_DIR, 'aapt2.exe')
ANDROID_JAR = os.path.join(ANDROID_DIR, 'android.jar')
D8_JAR = os.path.join(ANDROID_DIR, 'd8.jar')

BUILD_DIR = os.path.join(BASE_DIR, 'build')
OUTPUT_APK = os.path.join(BASE_DIR, 'chain-reaction-multiplayer.apk')

def ensure_tools():
    """Automatically downloads required build tools if not already present."""
    os.makedirs(TOOLS_DIR, exist_ok=True)
    os.makedirs(ANDROID_DIR, exist_ok=True)

    # 1. Check JDK
    if not os.path.exists(JAVA) or not os.path.exists(JAVAC):
        print("[Setup] Portable OpenJDK not found. Downloading Adoptium JDK 21 (~195MB)...")
        jdk_zip = os.path.join(TOOLS_DIR, 'jdk.zip')
        jdk_url = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip'
        urllib.request.urlretrieve(jdk_url, jdk_zip)
        print("[Setup] Extracting JDK...")
        with zipfile.ZipFile(jdk_zip, 'r') as z:
            z.extractall(TOOLS_DIR)
        for d in os.listdir(TOOLS_DIR):
            if d.startswith('jdk-21'):
                target = os.path.join(TOOLS_DIR, 'jdk')
                if os.path.exists(target):
                    shutil.rmtree(target)
                os.rename(os.path.join(TOOLS_DIR, d), target)
                break
        if os.path.exists(jdk_zip):
            os.remove(jdk_zip)
        print("[Setup] JDK ready at tools/jdk!")

    # 2. Check android.jar
    if not os.path.exists(ANDROID_JAR):
        print("[Setup] Downloading android.jar (21MB)...")
        urllib.request.urlretrieve('https://raw.githubusercontent.com/Sable/android-platforms/master/android-30/android.jar', ANDROID_JAR)

    # 3. Check aapt2.exe
    if not os.path.exists(AAPT2):
        print("[Setup] Downloading aapt2.exe...")
        temp_jar = os.path.join(ANDROID_DIR, 'aapt2.jar')
        urllib.request.urlretrieve('https://dl.google.com/dl/android/maven2/com/android/tools/build/aapt2/8.2.2-10154469/aapt2-8.2.2-10154469-windows.jar', temp_jar)
        with zipfile.ZipFile(temp_jar, 'r') as z:
            with open(AAPT2, 'wb') as f:
                f.write(z.read('aapt2.exe'))
        os.remove(temp_jar)

    # 4. Check d8.jar
    if not os.path.exists(D8_JAR):
        print("[Setup] Downloading d8.jar (14MB)...")
        urllib.request.urlretrieve('https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.2.42/r8-8.2.42.jar', D8_JAR)

    # 5. Check uber-apk-signer.jar
    if not os.path.exists(UBER_SIGNER):
        print("[Setup] Downloading uber-apk-signer.jar (3MB)...")
        urllib.request.urlretrieve('https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar', UBER_SIGNER)

def run_cmd(cmd, cwd=None):
    print("Running:", " ".join(cmd) if isinstance(cmd, list) else cmd)
    res = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if res.returncode != 0:
        print("STDERR:", res.stderr)
        print("STDOUT:", res.stdout)
        raise RuntimeError(f"Command failed with code {res.returncode}")
    return res.stdout

def build():
    print("====================================================")
    print("       BUILDING CHAIN REACTION MULTIPLAYER APK      ")
    print("====================================================")

    ensure_tools()

    # Clean / prepare build directories
    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    os.makedirs(BUILD_DIR, exist_ok=True)

    gen_dir = os.path.join(BUILD_DIR, 'gen')
    classes_dir = os.path.join(BUILD_DIR, 'classes')
    dex_dir = os.path.join(BUILD_DIR, 'dex')
    signed_dir = os.path.join(BUILD_DIR, 'signed')
    os.makedirs(gen_dir, exist_ok=True)
    os.makedirs(classes_dir, exist_ok=True)
    os.makedirs(dex_dir, exist_ok=True)
    os.makedirs(signed_dir, exist_ok=True)

    # Step 1: AAPT2 Compile Resources
    print("\n[1/5] Compiling Android resources with AAPT2...")
    compiled_res = os.path.join(BUILD_DIR, 'res.zip')
    res_dir = os.path.join(BASE_DIR, 'android_src', 'res')
    run_cmd([AAPT2, 'compile', '--dir', res_dir, '-o', compiled_res])

    # Step 2: AAPT2 Link (generate base APK and R.java)
    print("\n[2/5] Linking resources & AndroidManifest...")
    manifest = os.path.join(BASE_DIR, 'android_src', 'AndroidManifest.xml')
    base_apk = os.path.join(BUILD_DIR, 'base.apk')
    run_cmd([
        AAPT2, 'link',
        '-o', base_apk,
        '-I', ANDROID_JAR,
        '--manifest', manifest,
        '--java', gen_dir,
        compiled_res,
        '--auto-add-overlay'
    ])

    # Step 3: Compile Java source (MainActivity.java + R.java)
    print("\n[3/5] Compiling Java sources with javac...")
    r_java = os.path.join(gen_dir, 'com', 'chainreaction', 'multiplayer', 'R.java')
    main_java = os.path.join(BASE_DIR, 'android_src', 'src', 'com', 'chainreaction', 'multiplayer', 'MainActivity.java')
    run_cmd([
        JAVAC,
        '-source', '1.8',
        '-target', '1.8',
        '-cp', ANDROID_JAR,
        '-d', classes_dir,
        r_java,
        main_java
    ])

    # Step 4: D8 Dexing (.class -> classes.dex)
    print("\n[4/5] Compiling bytecode into classes.dex with D8...")
    class_files = []
    for root, _, files in os.walk(classes_dir):
        for f in files:
            if f.endswith('.class'):
                class_files.append(os.path.join(root, f))

    run_cmd([
        JAVA,
        '-cp', D8_JAR,
        'com.android.tools.r8.D8',
        '--min-api', '21',
        '--output', dex_dir
    ] + class_files)

    # Step 5: Bundle classes.dex and client/ files into APK assets/
    print("\n[5/5] Packaging classes.dex and web assets into unaligned APK...")
    classes_dex = os.path.join(dex_dir, 'classes.dex')
    client_dir = os.path.join(BASE_DIR, 'client')

    unaligned_apk = os.path.join(BUILD_DIR, 'unaligned.apk')
    shutil.copy2(base_apk, unaligned_apk)

    with zipfile.ZipFile(unaligned_apk, 'a', compression=zipfile.ZIP_DEFLATED) as apk:
        # Add classes.dex
        apk.write(classes_dex, 'classes.dex')

        # Add all client files to assets/
        for root, _, files in os.walk(client_dir):
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, client_dir)
                archive_name = 'assets/' + rel_path.replace('\\', '/')
                apk.write(full_path, archive_name)

    # Step 6: 4-byte ZipAlign & Sign with APK Signature Scheme v1, v2, v3
    print("\n[6/6] 4-Byte ZipAligning & Signing with Signature Scheme v1, v2, v3...")
    run_cmd([
        JAVA, '-jar', UBER_SIGNER,
        '--apks', unaligned_apk,
        '--out', signed_dir,
        '--allowResign'
    ])

    # Locate the output signed apk
    signed_apk_name = None
    for f in os.listdir(signed_dir):
        if f.endswith('.apk') and ('Signed' in f or 'aligned' in f):
            signed_apk_name = f
            break

    if not signed_apk_name:
        raise RuntimeError("Signed APK not found in signed directory!")

    final_signed = os.path.join(signed_dir, signed_apk_name)
    shutil.copy2(final_signed, OUTPUT_APK)

    print("\n====================================================")
    print(f" SUCCESS! PROPERLY SIGNED (V1+V2+V3) APK CREATED AT:")
    print(f" {OUTPUT_APK}")
    print(f" Size: {os.path.getsize(OUTPUT_APK):,} bytes")
    print("====================================================")

if __name__ == '__main__':
    build()
