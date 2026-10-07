# 🎧 Discord Follow

> Follow a Discord user and **automatically join their voice channel** in real time.

<p align="center">
  <img src="https://img.shields.io/badge/version-21-5865F2?style=flat-square&logo=discord&logoColor=white" />
  <img src="https://img.shields.io/badge/Discord-Web-5865F2?style=flat-square&logo=discord&logoColor=white" />
</p>

---

## ✨ At a glance

A script you paste into the Discord console that **watches a user** and **connects you to their voice channel** the moment they join one. Works across **all your servers** — no need to be on the same guild as the target. Floating, draggable UI with an opt-in log panel.

---

## 🚀 Quick start

**1.** Open [discord.com/app](https://discord.com/app) or Discord App → `F12` or `CTRL + SHIFT + I` → **Console** tab  
**2.** If prompted, type `allow pasting` then `Enter`  
**3.** Paste the script → `Enter` → panel appears 🎉

> 💡 Save it as a **Snippet** (Sources → Snippets) to reuse it in one click.

---

## 🎮 Usage

| Action | How |
|--------|-----|
| 🔍 **Load a user** | Paste their ID → **Load** |
| ▶️ **Follow** | Click **Start follow** |
| 🎯 **Join their voice** | Click the **voice badge** (works for any shared server or DM) |
| 👤 **Open profile** | Click avatar, name, or `@username` |
| 📜 **View logs** | Click **Logs** to expand — badge shows unread count |
| ⏹️ **Stop** | **Stop follow** or press any key |

> **Find an ID?** Enable Developer Mode → right-click user → *Copy ID*.

---

## ⚡ Features

- 🎯 Real-time tracking (refresh every 1.2 s)
- 🔊 Auto-join target's voice channel — **across all your servers**
- 🌐 Global index of every server + channel you have access to
- 🏷️ Voice badge shows **guild icon + guild name + channel name**
- 🎨 Badge color reflects state (green = same server, blue = other server, grey = offline)
- 👤 Clickable profile card (opens native Discord profile)
- 📜 **Collapsible log panel** — replié par défaut, badge compteur pour les nouveaux événements
- 📊 Live index bar (`🌐 servers · 🔊 voice channels`)
- 🖱️ Draggable & collapsible UI (chevron top-right)
- ⌨️ Stop with any keypress
- 🔄 Auto-cleanup of previous instances

---

## 📜 Logs

The log panel is **collapsed by default** — a small badge appears when new events happen. It only shows **target actions**:

```
[13:20:01] anis → 🔊・General · Shibuya
[13:25:12] anis → Call with Bob
[13:30:00] anis → User disconnected
```

- `anis → #channel · Server` — target joined / moved to a voice channel (green)
- `anis → Call with Bob` — target joined a DM or group call (green)
- `anis → User disconnected` — target left voice / went invisible (orange)

> If the target is on a server you don't share, Discord doesn't expose that info — the target simply appears as `User disconnected`.

---

## ⚠️ Disclaimer

> This project is **for educational purposes only**. It may violate **Discord's ToS** and result in a **ban**.  
> Tracking someone without their consent may be **illegal**.  
> **Use at your own risk.**

---

## 🐛 Troubleshooting

| Error | Fix |
|-------|-----|
| `Cache insufficient` | Press `F5` and rerun |
| `One of the stores could not be found` | Discord updated → reload the page |
| Target shows `User disconnected` while in voice | Target is on a server you don't share, or in a DM without you |
| No auto-join | Check channel permissions (`Connect` + `Speak`) |
| Console blocks paste | Type `allow pasting` first |

---

<p align="center">
  <b>Made with 💙</b><br>
  <sub>⭐ A star is always appreciated</sub>
</p>