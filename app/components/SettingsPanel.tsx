"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  resetSettings,
  writeSettings,
  type NextCount,
  type Settings,
  type Theme,
} from "../lib/settings";

const LABEL = "text-[10px] font-medium uppercase tracking-[0.25em] text-foreground/40";

export default function SettingsPanel({
  settings,
  onClose,
}: {
  settings: Settings;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background/80 backdrop-blur-md">
      <header className="flex shrink-0 items-center justify-between border-b border-foreground/[0.08] px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-foreground/70">
          Sozlamalar
        </span>
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Yopish"
          className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-foreground/10 bg-foreground/[0.05] text-foreground/70 transition hover:bg-foreground/[0.12] hover:text-foreground"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </header>

      <div className="flex-1 divide-y divide-foreground/[0.06] overflow-y-auto overscroll-contain px-4">
        <Row label="Tema">
          <Segmented<Theme>
            value={settings.theme}
            options={[
              { value: "auto", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(theme) => writeSettings({ theme })}
          />
        </Row>

        <Slider
          label="Effektlar"
          value={settings.sfxVolume}
          display={`${Math.round(settings.sfxVolume * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(sfxVolume) => writeSettings({ sfxVolume })}
        />

        <Slider
          label="Musiqa"
          value={settings.musicVolume}
          display={`${Math.round(settings.musicVolume * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(musicVolume) => writeSettings({ musicVolume })}
        />

        <Slider
          label="Boshlang'ich daraja"
          value={settings.startLevel}
          display={String(settings.startLevel)}
          min={1}
          max={10}
          step={1}
          hint="Keyingi o'yindan boshlab"
          onChange={(startLevel) => writeSettings({ startLevel })}
        />

        <Row label="Next bloklar">
          <Segmented<NextCount>
            value={settings.nextCount}
            options={[
              { value: 1, label: "1" },
              { value: 3, label: "3" },
              { value: 5, label: "5" },
            ]}
            onChange={(nextCount) => writeSettings({ nextCount })}
          />
        </Row>

        <Row label="Hold" hint="C — blokni saqlash">
          <Toggle
            checked={settings.hold}
            label="Hold"
            onChange={(hold) => writeSettings({ hold })}
          />
        </Row>

        <Row label="Soya" hint="Blok qayerga tushishi">
          <Toggle
            checked={settings.ghost}
            label="Soya"
            onChange={(ghost) => writeSettings({ ghost })}
          />
        </Row>

        <Row label="Tebranish" hint="Telefonda">
          <Toggle
            checked={settings.vibration}
            label="Tebranish"
            onChange={(vibration) => writeSettings({ vibration })}
          />
        </Row>

        <Row label="Gesture qo'llanmasi" hint="Boshlang'ich ekranda">
          <Toggle
            checked={!settings.gesturesSeen}
            label="Gesture qo'llanmasi"
            onChange={(show) => writeSettings({ gesturesSeen: !show })}
          />
        </Row>
      </div>

      <footer className="shrink-0 border-t border-foreground/[0.08] px-4 py-3">
        <button
          onClick={resetSettings}
          className="cursor-pointer text-[10px] uppercase tracking-[0.25em] text-foreground/35 transition hover:text-foreground/70"
        >
          Standart holatga qaytarish
        </button>
      </footer>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className={LABEL}>{label}</p>
        {hint && (
          <p className="mt-1 text-[9px] uppercase tracking-[0.15em] text-foreground/25">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className={LABEL}>{label}</p>
        <span className="font-mono text-[11px] font-semibold tabular-nums text-foreground/70">
          {display}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2.5 w-full cursor-pointer accent-foreground"
      />
      {hint && (
        <p className="mt-0.5 text-[9px] uppercase tracking-[0.15em] text-foreground/25">
          {hint}
        </p>
      )}
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-foreground/10 bg-foreground/[0.04] p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`cursor-pointer rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.15em] transition ${
              active
                ? "bg-foreground text-background"
                : "text-foreground/45 hover:text-foreground/80"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 cursor-pointer rounded-full transition ${
        checked ? "bg-foreground" : "bg-foreground/20"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-all ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
