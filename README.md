> Локальная сборка 1.1.0-local.1: см. LOCAL_BUILD_RU.md. Описание ниже относится к исходному проекту.

# Drama Director — Novella (Visual Novel)

## Local 3D scene extension

The **3D** tab supports GLB/GLTF/FBX environment objects and character models, animations, camera and lighting controls, and scene persistence. Mouse Control opens a separate draggable editor with object transforms and locks. The **STT** button can download multilingual Whisper tiny for local browser transcription. Three.js and the Whisper runtime are bundled locally. See [3D, Mixamo, and Whisper guide (Russian)](SCENE_3D_RU.md) for usage, limitations, and tests.

<p align="center">
  <a href="https://discord.gg/wSfn962R">
    <img alt="Join the Discord" src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?style=for-the-badge&logo=discord&logoColor=white">
  </a>
  &nbsp;
  <a href="https://www.donationalerts.com/r/pronikxside">
    <img alt="Donate via DonationAlerts" src="https://img.shields.io/badge/Donate-DonationAlerts-FF5C5C?style=for-the-badge&logo=ko-fi&logoColor=white">
  </a>
</p>

<p align="center">
  <img alt="Foundry VTT" src="https://img.shields.io/badge/Foundry%20VTT-v13%20%E2%80%93%20v14-fe6a1f?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="Requires Hub" src="https://img.shields.io/badge/requires-drama--director--hub-blue?style=flat-square">
</p>

---

## What is it?

A full Visual Novel layer for Foundry. Place characters, swap backgrounds, drive emotion wheels and run dialog with player-side mic input — all without leaving the table. Ships 6 categories of background videos, per-actor character + emotion presets, drag/drop layered scenes (text / image / interactive), microphone with VAD and optional speech recognition, GM bar, full overlay UI, settings preset import/export.

Part of the [**Drama Director**](https://github.com/phoenix1cold/drama-director-hub) module family. Requires the **drama-director-hub** module — install it first.

---

## Install in Foundry VTT

1. First install the hub:
   ```
   https://github.com/phoenix1cold/drama-director-hub/releases/latest/download/module.json
   ```
2. Then this module — open **Add-on Modules** → **Install Module**, paste the **manifest URL**:
   ```
   https://github.com/phoenix1cold/drama-director-novella/releases/latest/download/module.json
   ```
3. Click **Install**. Future updates: Foundry checks the same URL and offers an in-app update whenever a new release is published. The hub also surfaces a one-click update badge.

### Manual install (offline)

Download `module.zip` from the [latest release](https://github.com/phoenix1cold/drama-director-novella/releases/latest) and extract it into your Foundry user-data folder at:

```
<FoundryUserData>/Data/modules/drama-director-novella/
```

The extracted folder must contain `module.json` at its root.

---

## Support / Community

- **Discord:** https://discord.gg/wSfn962R
- **Issues:** https://github.com/phoenix1cold/drama-director-novella/issues
- **Donate:** https://www.donationalerts.com/r/pronikxside
