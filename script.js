/**
 * Focus Nest — Pomodoro companion with single-track lo-fi music.
 * Timer accuracy: remaining time is derived from an end timestamp.
 * Session restore: compact versioned cookie (see cookies helpers below).
 */

(() => {
  "use strict";

  const PREFS_KEY = "focus-nest-prefs";
  const SESSION_COOKIE = "fn_session_v1";
  const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

  const DEFAULT_DURATIONS = { focus: 25, short: 5, long: 15 };

  const MODE_META = {
    focus: { label: "Focus session" },
    short: { label: "Short break" },
    long: { label: "Long break" },
  };

  /** Licensed Mixkit lo-fi / chill tracks — one plays at a time. */
  const TRACKS = [
    {
      id: "soft",
      label: "Soft lo-fi beats",
      src: "assets/audio/soft-lofi.mp3",
      source: "Mixkit — Sweet September (Arulo) #282",
    },
    {
      id: "rainy",
      label: "Rainy-day lo-fi",
      src: "assets/audio/rainy-lofi.mp3",
      source: "Mixkit — Sleepy Cat (Alejandro Magaña) #135",
    },
    {
      id: "dreamy",
      label: "Dreamy instrumental lo-fi",
      src: "assets/audio/dreamy-lofi.mp3",
      source: "Mixkit — Digital Clouds (Alejandro Magaña) #175",
    },
    {
      id: "minimal",
      label: "Minimal chill beats",
      src: "assets/audio/minimal-chill.mp3",
      source: "Mixkit — Curiosity (Diego Nava) #480",
    },
  ];

  // --- Cookie helpers (timer session only) ---
  const cookies = {
    get(name) {
      const prefix = `${encodeURIComponent(name)}=`;
      const parts = document.cookie.split("; ");
      for (const part of parts) {
        if (part.startsWith(prefix)) {
          return decodeURIComponent(part.slice(prefix.length));
        }
      }
      return null;
    },
    set(name, value, maxAgeSec) {
      document.cookie = [
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        "path=/",
        `max-age=${maxAgeSec}`,
        "SameSite=Lax",
      ].join("; ");
    },
    remove(name) {
      document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
    },
  };

  // --- DOM ---
  const els = {
    body: document.body,
    display: document.getElementById("timer-display"),
    modeLabel: document.getElementById("timer-mode-label"),
    status: document.getElementById("timer-status"),
    start: document.getElementById("btn-start"),
    pause: document.getElementById("btn-pause"),
    reset: document.getElementById("btn-reset"),
    modeTabs: document.querySelectorAll(".mode-tab"),
    sessionCount: document.getElementById("session-count"),
    sessionDots: document.getElementById("session-dots"),
    sessionHint: document.getElementById("session-hint"),
    nowPlayingText: document.getElementById("now-playing-text"),
    audioBanner: document.getElementById("audio-banner"),
    musicResumeBanner: document.getElementById("music-resume-banner"),
    resumeMusic: document.getElementById("btn-resume-music"),
    muteBtn: document.getElementById("btn-mute"),
    toast: document.getElementById("toast"),
    toastMessage: document.getElementById("toast-message"),
    settingsModal: document.getElementById("settings-modal"),
    settingsOpen: document.getElementById("settings-open"),
    settingsClose: document.getElementById("settings-close"),
    settingsForm: document.getElementById("settings-form"),
    settingsNote: document.getElementById("settings-note"),
    settingFocus: document.getElementById("setting-focus"),
    settingShort: document.getElementById("setting-short"),
    settingLong: document.getElementById("setting-long"),
    settingVolume: document.getElementById("setting-volume"),
    settingRepeat: document.getElementById("setting-repeat"),
    trackList: document.getElementById("track-list"),
  };

  // --- Preferences (localStorage) ---
  let prefs = loadPrefs();

  // --- Timer state ---
  let mode = "focus";
  let remainingMs = prefs.focus * 60 * 1000;
  let endAt = null;
  let intervalId = null;
  let running = false;
  /** idle | running | paused | finished — finished means completion already counted */
  let phase = "idle";
  let completedFocus = 0;
  let toastTimer = null;
  let persistTimer = null;

  // --- Music state (single Audio element) ---
  const player = new Audio();
  player.preload = "metadata";
  let selectedTrackId = prefs.trackId;
  let muted = prefs.muted;
  let volume = prefs.volume;
  let repeat = prefs.repeat;
  /** User has started music at least once this visit (or wanted it before refresh). */
  let musicDesired = prefs.musicDesired;
  let savedMusicTime = prefs.musicTime || 0;
  let trackAvailable = {};
  let pendingResumePrompt = false;

  // --- Prefs ---
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const trackId = TRACKS.some((t) => t.id === parsed.trackId)
        ? parsed.trackId
        : TRACKS[0].id;
      return {
        focus: clampInt(parsed.focus, 1, 120, DEFAULT_DURATIONS.focus),
        short: clampInt(parsed.short, 1, 60, DEFAULT_DURATIONS.short),
        long: clampInt(parsed.long, 1, 90, DEFAULT_DURATIONS.long),
        trackId,
        muted: Boolean(parsed.muted),
        volume: clampNum(parsed.volume, 0, 1, 0.5),
        repeat: Boolean(parsed.repeat),
        musicDesired: Boolean(parsed.musicDesired),
        musicTime: clampNum(parsed.musicTime, 0, 86400, 0),
      };
    } catch {
      return {
        ...DEFAULT_DURATIONS,
        trackId: TRACKS[0].id,
        muted: false,
        volume: 0.5,
        repeat: false,
        musicDesired: false,
        musicTime: 0,
      };
    }
  }

  function savePrefs() {
    prefs = {
      focus: prefs.focus,
      short: prefs.short,
      long: prefs.long,
      trackId: selectedTrackId,
      muted,
      volume,
      repeat,
      musicDesired,
      musicTime: Number.isFinite(player.currentTime) ? player.currentTime : savedMusicTime,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function durationFor(modeKey) {
    return prefs[modeKey] * 60 * 1000;
  }

  function trackById(id) {
    return TRACKS.find((t) => t.id === id) || TRACKS[0];
  }

  // --- Session cookie ---
  function buildSessionPayload() {
    return {
      v: 1,
      mode,
      phase,
      remainingMs: Math.max(0, Math.round(remainingMs)),
      endAt: running && endAt ? endAt : null,
      completedFocus,
      // Durations snapshot so restore matches the session that was running
      focus: prefs.focus,
      short: prefs.short,
      long: prefs.long,
    };
  }

  function persistSession() {
    try {
      cookies.set(SESSION_COOKIE, JSON.stringify(buildSessionPayload()), COOKIE_MAX_AGE_SEC);
    } catch {
      // Cookie failures must not break the timer
    }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistSession, 120);
  }

  function restoreSessionFromCookie() {
    const raw = cookies.get(SESSION_COOKIE);
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return false;
      if (!MODE_META[data.mode]) return false;

      const phases = ["idle", "running", "paused", "finished"];
      if (!phases.includes(data.phase)) return false;

      // Prefer durations from cookie so a mid-session refresh stays consistent
      prefs.focus = clampInt(data.focus, 1, 120, prefs.focus);
      prefs.short = clampInt(data.short, 1, 60, prefs.short);
      prefs.long = clampInt(data.long, 1, 90, prefs.long);

      mode = data.mode;
      completedFocus = clampInt(data.completedFocus, 0, 9999, 0);
      phase = data.phase;

      if (phase === "running" && data.endAt) {
        const end = Number(data.endAt);
        if (!Number.isFinite(end)) return false;
        const left = end - Date.now();
        if (left <= 0) {
          // Finished while the page was closed — complete exactly once
          remainingMs = 0;
          endAt = null;
          running = false;
          clearTick();
          phase = "finished";
          applyCompletionEffects(true);
          persistSession();
          return true;
        }
        remainingMs = left;
        endAt = end;
        running = true;
        phase = "running";
        clearTick();
        intervalId = setInterval(tick, 250);
        setStatus("Focus on the moment — timer running");
        updateControls();
        renderTimer();
        return true;
      }

      if (phase === "paused") {
        remainingMs = Math.max(0, Number(data.remainingMs) || 0);
        endAt = null;
        running = false;
        setStatus("Paused — music keeps playing independently");
        updateControls();
        renderTimer();
        return true;
      }

      if (phase === "finished") {
        remainingMs = 0;
        endAt = null;
        running = false;
        els.display.classList.add("is-complete");
        setStatus(
          mode === "focus"
            ? "Focus complete — take a short break when ready"
            : "Break over — start a focus session when you're ready"
        );
        updateControls();
        renderTimer();
        return true;
      }

      // idle / reset
      remainingMs = Math.max(0, Number(data.remainingMs) || durationFor(mode));
      if (remainingMs <= 0) remainingMs = durationFor(mode);
      endAt = null;
      running = false;
      phase = "idle";
      setStatus("Ready when you are");
      updateControls();
      renderTimer();
      return true;
    } catch {
      cookies.remove(SESSION_COOKIE);
      return false;
    }
  }

  // --- Timer core ---
  function formatTime(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function clearTick() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function tick() {
    if (!running || endAt === null) return;
    remainingMs = Math.max(0, endAt - Date.now());
    renderTimer();
    schedulePersist();
    if (remainingMs <= 0) {
      completeSession();
    }
  }

  function startTimer() {
    if (running) return;
    if (phase === "finished" || remainingMs <= 0) {
      remainingMs = durationFor(mode);
    }
    endAt = Date.now() + remainingMs;
    running = true;
    phase = "running";
    clearTick();
    intervalId = setInterval(tick, 250);
    els.display.classList.remove("is-complete");
    updateControls();
    setStatus("Focus on the moment — timer running");
    persistSession();
    tick();
  }

  function pauseTimer() {
    if (!running) return;
    remainingMs = Math.max(0, endAt - Date.now());
    endAt = null;
    running = false;
    phase = "paused";
    clearTick();
    updateControls();
    setStatus("Paused — music keeps playing independently");
    renderTimer();
    persistSession();
  }

  function resetTimer() {
    running = false;
    endAt = null;
    phase = "idle";
    clearTick();
    remainingMs = durationFor(mode);
    els.display.classList.remove("is-complete");
    updateControls();
    setStatus("Ready when you are");
    renderTimer();
    persistSession();
  }

  function setMode(nextMode) {
    if (!MODE_META[nextMode]) return;
    mode = nextMode;
    resetTimer();
    syncModeUI();
  }

  function applyCompletionEffects(fromRestore) {
    els.display.classList.add("is-complete");
    updateControls();
    renderTimer();

    if (mode === "focus") {
      completedFocus += 1;
      renderSessions();
      const suggestLong = completedFocus > 0 && completedFocus % 4 === 0;
      setStatus(
        suggestLong
          ? "Focus complete — consider a long break"
          : "Focus complete — take a short break when ready"
      );
      if (!fromRestore) {
        showToast(
          suggestLong
            ? "Nice work! Four sessions done — a long break is a good idea."
            : "Focus session complete. Great job."
        );
        playChime();
      } else {
        showToast("Your focus session finished while you were away.");
      }
    } else {
      setStatus("Break over — start a focus session when you're ready");
      if (!fromRestore) {
        showToast("Break finished. Ready for another focus block?");
        playChime();
      } else {
        showToast("Your break finished while you were away.");
      }
    }
  }

  function completeSession() {
    if (phase === "finished") {
      // Already counted — keep UI stable across refreshes
      running = false;
      endAt = null;
      remainingMs = 0;
      clearTick();
      persistSession();
      return;
    }
    running = false;
    endAt = null;
    remainingMs = 0;
    phase = "finished";
    clearTick();
    applyCompletionEffects(false);
    persistSession();
  }

  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.18 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.18);
        osc.stop(now + i * 0.18 + 0.5);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch {
      /* optional */
    }
  }

  // --- Render ---
  function renderTimer() {
    els.display.textContent = formatTime(remainingMs);
    document.title =
      remainingMs > 0 && (running || phase === "paused")
        ? `${formatTime(remainingMs)} · Focus Nest`
        : "Focus Nest — Pomodoro Companion";
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function updateControls() {
    els.start.disabled = running;
    els.pause.disabled = !running;
    const canResume = !running && phase === "paused" && remainingMs > 0;
    els.start.querySelector("span").textContent = canResume ? "Resume" : "Start";
    els.start.setAttribute("aria-label", canResume ? "Resume timer" : "Start timer");
  }

  function syncModeUI() {
    els.body.dataset.mode = mode;
    els.modeLabel.textContent = MODE_META[mode].label;
    els.modeTabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function renderSessions() {
    els.sessionCount.textContent = String(completedFocus);
    const dotsFilled =
      completedFocus === 0 ? 0 : completedFocus % 4 === 0 ? 4 : completedFocus % 4;

    els.sessionDots.innerHTML = "";
    for (let i = 0; i < 4; i += 1) {
      const li = document.createElement("li");
      li.className = "session-dot" + (i < dotsFilled ? " is-filled" : "");
      li.setAttribute("role", "listitem");
      li.setAttribute(
        "aria-label",
        i < dotsFilled ? `Session ${i + 1} complete` : `Session ${i + 1} pending`
      );
      li.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
      els.sessionDots.appendChild(li);
    }
    els.sessionHint.hidden = !(completedFocus > 0 && completedFocus % 4 === 0);
  }

  function showToast(message) {
    els.toastMessage.textContent = message;
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 4500);
  }

  function updateNowPlaying() {
    const track = trackById(selectedTrackId);
    if (trackAvailable[selectedTrackId] === false) {
      els.nowPlayingText.textContent = `${track.label} — file missing`;
      return;
    }
    if (muted) {
      els.nowPlayingText.textContent = `${track.label} (muted)`;
    } else if (!player.paused && !player.ended) {
      els.nowPlayingText.textContent = `Playing · ${track.label}`;
    } else if (musicDesired) {
      els.nowPlayingText.textContent = `Selected · ${track.label}`;
    } else {
      els.nowPlayingText.textContent = `Selected · ${track.label}`;
    }
  }

  function updateMuteButton() {
    const icon = els.muteBtn.querySelector("i");
    els.muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    els.muteBtn.setAttribute("aria-label", muted ? "Unmute music" : "Mute music");
    els.muteBtn.title = muted ? "Unmute music" : "Mute music";
    icon.className = muted ? "fa-solid fa-volume-xmark" : "fa-solid fa-volume-high";
  }

  function showAudioBanner(message, isError) {
    els.audioBanner.hidden = false;
    els.audioBanner.classList.toggle("is-error", Boolean(isError));
    els.audioBanner.innerHTML =
      `<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${message}`;
  }

  function hideAudioBanner() {
    els.audioBanner.hidden = true;
  }

  function showResumePrompt(show) {
    pendingResumePrompt = show;
    els.musicResumeBanner.hidden = !show;
  }

  // --- Music (single track) ---
  function applyPlayerVolume() {
    player.volume = muted ? 0 : volume;
    player.loop = repeat;
  }

  function loadTrackSource(trackId, preserveTime) {
    const track = trackById(trackId);
    const time = preserveTime
      ? Number.isFinite(player.currentTime)
        ? player.currentTime
        : savedMusicTime
      : 0;

    // Stop any current playback before swapping source
    player.pause();
    player.removeAttribute("src");
    player.load();

    player.src = track.src;
    player.loop = repeat;
    applyPlayerVolume();

    return new Promise((resolve) => {
      const onReady = () => {
        cleanup();
        trackAvailable[trackId] = true;
        try {
          if (preserveTime && time > 0 && Number.isFinite(player.duration)) {
            player.currentTime = Math.min(time, Math.max(0, player.duration - 0.25));
          } else if (!preserveTime) {
            player.currentTime = 0;
          }
        } catch {
          /* ignore seek errors */
        }
        resolve(true);
      };
      const onError = () => {
        cleanup();
        trackAvailable[trackId] = false;
        resolve(false);
      };
      const cleanup = () => {
        player.removeEventListener("canplay", onReady);
        player.removeEventListener("error", onError);
      };
      player.addEventListener("canplay", onReady, { once: true });
      player.addEventListener("error", onError, { once: true });
      player.load();
    });
  }

  async function playSelected({ userGesture } = {}) {
    if (muted) {
      updateNowPlaying();
      return false;
    }
    if (trackAvailable[selectedTrackId] === false) {
      showAudioBanner(
        `Missing file for “${trackById(selectedTrackId).label}”. See assets/audio/README.md.`,
        true
      );
      return false;
    }

    applyPlayerVolume();
    try {
      await player.play();
      musicDesired = true;
      hideAudioBanner();
      showResumePrompt(false);
      savePrefs();
      updateNowPlaying();
      return true;
    } catch (err) {
      // Autoplay policy or other block
      musicDesired = true;
      savePrefs();
      if (userGesture) {
        showAudioBanner(
          "Could not start playback. Check the audio file or try again.",
          true
        );
      } else {
        showResumePrompt(true);
      }
      updateNowPlaying();
      return false;
    }
  }

  async function selectTrack(trackId, { fromSettings } = {}) {
    if (!TRACKS.some((t) => t.id === trackId)) return;

    // Same track — do not create a second playback instance
    if (trackId === selectedTrackId && player.src && !player.error) {
      selectedTrackId = trackId;
      updateTrackListUI();
      updateNowPlaying();
      if (fromSettings && musicDesired && !muted && player.paused) {
        await playSelected({ userGesture: true });
      }
      return;
    }

    // Capture position of previous track before switching
    if (!player.paused) {
      savedMusicTime = player.currentTime;
    }
    player.pause();

    selectedTrackId = trackId;
    savedMusicTime = 0;
    savePrefs();
    updateTrackListUI();

    const ok = await loadTrackSource(trackId, false);
    if (!ok) {
      showAudioBanner(
        `Could not load “${trackById(trackId).label}”. Add the MP3 under assets/audio/.`,
        true
      );
      updateNowPlaying();
      return;
    }

    hideAudioBanner();
    // Start only if music is desired and not muted — never unmute by changing track
    if (musicDesired && !muted) {
      await playSelected({ userGesture: Boolean(fromSettings) });
    } else if (fromSettings && !muted && !musicDesired) {
      // First selection in settings counts as user intent to listen
      musicDesired = true;
      savePrefs();
      await playSelected({ userGesture: true });
    } else {
      updateNowPlaying();
    }
  }

  function setMuted(nextMuted) {
    // Preserve position: pause when muting, remember currentTime; resume on unmute
    if (nextMuted && !muted) {
      if (!player.paused) {
        savedMusicTime = player.currentTime;
        player.pause();
      } else if (Number.isFinite(player.currentTime)) {
        savedMusicTime = player.currentTime;
      }
      muted = true;
      applyPlayerVolume();
    } else if (!nextMuted && muted) {
      muted = false;
      applyPlayerVolume();
      try {
        if (savedMusicTime > 0) {
          player.currentTime = savedMusicTime;
        }
      } catch {
        /* ignore */
      }
      if (musicDesired) {
        playSelected({ userGesture: true });
      }
    }
    savePrefs();
    updateMuteButton();
    updateNowPlaying();
  }

  function setVolume(next) {
    volume = clampNum(next, 0, 1, volume);
    applyPlayerVolume();
    savePrefs();
  }

  function probeAllTracks() {
    TRACKS.forEach((track) => {
      const probe = new Audio();
      probe.preload = "metadata";
      probe.addEventListener(
        "canplaythrough",
        () => {
          trackAvailable[track.id] = true;
        },
        { once: true }
      );
      probe.addEventListener(
        "error",
        () => {
          trackAvailable[track.id] = false;
          if (track.id === selectedTrackId) {
            showAudioBanner(
              `Missing “${track.label}”. Place the file at ${track.src}.`,
              true
            );
          }
        },
        { once: true }
      );
      probe.src = track.src;
      probe.load();
    });
  }

  function buildTrackList() {
    els.trackList.innerHTML = "";
    TRACKS.forEach((track) => {
      const label = document.createElement("label");
      label.className = "track-option";
      label.innerHTML = `
        <input type="radio" name="lofi-track" value="${track.id}" />
        <span class="track-option-body">
          <span class="track-option-title">
            <i class="fa-solid fa-music" aria-hidden="true"></i>
            ${track.label}
          </span>
          <span class="track-option-meta">${track.source}</span>
        </span>
      `;
      els.trackList.appendChild(label);
    });
    updateTrackListUI();
  }

  function updateTrackListUI() {
    els.trackList.querySelectorAll('input[name="lofi-track"]').forEach((input) => {
      input.checked = input.value === selectedTrackId;
      input.closest(".track-option")?.classList.toggle("is-selected", input.checked);
    });
  }

  // --- Settings ---
  function openSettings() {
    els.settingFocus.value = prefs.focus;
    els.settingShort.value = prefs.short;
    els.settingLong.value = prefs.long;
    els.settingVolume.value = Math.round(volume * 100);
    els.settingRepeat.checked = repeat;
    updateTrackListUI();
    els.settingsNote.hidden = true;
    els.settingsModal.hidden = false;
    els.settingsClose.focus();
  }

  function closeSettings() {
    els.settingsModal.hidden = true;
    els.settingsOpen.focus();
  }

  function applyDurationSettings(next) {
    const wasRunning = running;
    const prevDuration = durationFor(mode);
    const ratio =
      prevDuration > 0 ? Math.min(1, Math.max(0, remainingMs / prevDuration)) : 1;

    prefs.focus = next.focus;
    prefs.short = next.short;
    prefs.long = next.long;
    savePrefs();

    if (phase === "finished") {
      // Leave finished state until user starts/resets
      persistSession();
      return;
    }

    if (wasRunning) {
      remainingMs = Math.round(durationFor(mode) * ratio);
      endAt = Date.now() + remainingMs;
    } else if (phase === "idle" || remainingMs === prevDuration) {
      remainingMs = durationFor(mode);
    } else {
      remainingMs = Math.round(durationFor(mode) * ratio);
    }

    renderTimer();
    updateControls();
    persistSession();
  }

  // --- Events ---
  function bindEvents() {
    els.start.addEventListener("click", startTimer);
    els.pause.addEventListener("click", pauseTimer);
    els.reset.addEventListener("click", resetTimer);

    els.modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => setMode(tab.dataset.mode));
    });

    els.muteBtn.addEventListener("click", () => setMuted(!muted));
    els.resumeMusic.addEventListener("click", () => {
      playSelected({ userGesture: true });
    });

    els.settingsOpen.addEventListener("click", openSettings);
    els.settingsClose.addEventListener("click", closeSettings);
    els.settingsModal.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", closeSettings);
    });

    els.trackList.addEventListener("change", (e) => {
      const input = e.target.closest('input[name="lofi-track"]');
      if (!input) return;
      selectTrack(input.value, { fromSettings: true });
    });

    els.settingVolume.addEventListener("input", () => {
      setVolume(Number(els.settingVolume.value) / 100);
    });

    els.settingRepeat.addEventListener("change", () => {
      repeat = els.settingRepeat.checked;
      player.loop = repeat;
      savePrefs();
    });

    els.settingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const focus = Number(els.settingFocus.value);
      const short = Number(els.settingShort.value);
      const long = Number(els.settingLong.value);

      if (
        !Number.isFinite(focus) ||
        !Number.isFinite(short) ||
        !Number.isFinite(long) ||
        focus < 1 ||
        short < 1 ||
        long < 1 ||
        focus > 120 ||
        short > 60 ||
        long > 90
      ) {
        els.settingsNote.hidden = false;
        els.settingsNote.textContent =
          "Enter whole minutes greater than zero (focus 1–120, short 1–60, long 1–90).";
        return;
      }

      repeat = els.settingRepeat.checked;
      player.loop = repeat;
      setVolume(Number(els.settingVolume.value) / 100);

      applyDurationSettings({
        focus: Math.round(focus),
        short: Math.round(short),
        long: Math.round(long),
      });
      closeSettings();
      showToast("Settings saved.");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.settingsModal.hidden) closeSettings();
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && running) tick();
      if (!document.hidden) savePrefs();
    });

    player.addEventListener("ended", () => {
      if (!repeat) {
        updateNowPlaying();
        savePrefs();
      }
    });

    player.addEventListener("timeupdate", () => {
      if (!player.paused) {
        savedMusicTime = player.currentTime;
      }
    });

    window.addEventListener("beforeunload", () => {
      savePrefs();
      persistSession();
    });
  }

  // --- Init ---
  async function init() {
    buildTrackList();
    bindEvents();
    probeAllTracks();
    updateMuteButton();
    applyPlayerVolume();

    const restored = restoreSessionFromCookie();
    if (!restored) {
      mode = "focus";
      phase = "idle";
      remainingMs = durationFor(mode);
      running = false;
      endAt = null;
      completedFocus = 0;
      setStatus("Ready when you are");
      updateControls();
      renderTimer();
      persistSession();
    }

    syncModeUI();
    renderSessions();

    const loaded = await loadTrackSource(selectedTrackId, true);
    if (!loaded) {
      showAudioBanner(
        `Missing “${trackById(selectedTrackId).label}”. See assets/audio/README.md.`,
        true
      );
    }
    updateNowPlaying();

    // After refresh: remember selection/mute, but do not autoplay
    if (musicDesired && !muted && loaded) {
      showResumePrompt(true);
    }
  }

  init();
})();
