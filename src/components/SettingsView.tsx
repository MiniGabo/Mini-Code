// Settings tab content: editor, Java and general preferences.
// Rendered as a virtual read-only tab (id "settings"), not through Monaco.
import type { ReactNode } from "react";
import { useState } from "react";
import { Languages, Type, Coffee, RefreshCw } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "../i18n";
import { useSettingsStore, useT, FONT_FAMILIES, XMX_OPTIONS } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useUpdaterStore } from "../stores/updaterStore";

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 rounded-lg border border-graphite-800 bg-graphite-900 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-[14px] font-medium text-graphite-100">{title}</h2>
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[12.5px] text-graphite-300">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-graphite-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[#e08a3c]"
      />
      {label}
    </label>
  );
}

const selectClass =
  "block w-56 cursor-pointer rounded-md border border-graphite-600 bg-graphite-800 px-2.5 py-1.5 text-[13px] text-graphite-100 outline-none hover:border-graphite-500 focus:border-ember-500/60";
const inputClass =
  "block w-56 rounded-md border border-graphite-600 bg-graphite-800 px-2.5 py-1.5 text-[13px] text-graphite-100 outline-none hover:border-graphite-500 focus:border-ember-500/60";
const hintClass = "mt-1 text-[11.5px] leading-snug text-graphite-500";

function xmxLabel(v: string): string {
  const m = /^(\d+)([mMgG])$/.exec(v.trim());
  if (!m) return v;
  return m[2].toLowerCase() === "g" ? `${m[1]} GB` : `${m[1]} MB`;
}

export default function SettingsView() {
  const t = useT();
  const s = useSettingsStore();
  const update = useSettingsStore((st) => st.updateSettings);
  const setLanguage = useSettingsStore((st) => st.setLanguage);
  const notifyError = useUiStore((st) => st.notifyError);
  // Draft while typing a JDK path: committed (and validated) on blur/Enter.
  const [jdkDraft, setJdkDraft] = useState<string | null>(null);

  if (!s.ready) {
    return (
      <div className="flex h-full items-center justify-center bg-graphite-950">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-graphite-700 border-t-ember-400" />
      </div>
    );
  }

  const numberInput = (
    value: number,
    apply: (n: number) => void,
  ) => (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) apply(n);
      }}
      className={`${inputClass} w-24`}
    />
  );

  const pickJdk = async () => {
    let dir: string | null = null;
    try {
      dir = (await window.electronAPI?.pickJdk?.()) ?? null;
    } catch {
      dir = null;
    }
    if (!dir) return; // dialog cancelled or unavailable
    if (await isValidJdk(dir)) update({ jdkPath: dir });
    // Invalid: isValidJdk already toasted; nothing is saved.
  };

  const isValidJdk = async (dir: string): Promise<boolean> => {
    const v = dir.trim();
    if (!v) return true; // empty = auto-detect, always valid
    try {
      const res = await window.electronAPI?.validateJdk?.(v);
      if (res && !res.ok) {
        notifyError(res.error ?? t("settings.java.jdkInvalid", { exe: "java", path: v }));
        return false;
      }
      return true;
    } catch {
      return true; // no bridge (browser): accept
    }
  };

  const commitJdkDraft = async () => {
    if (jdkDraft === null) return;
    const v = jdkDraft.trim();
    setJdkDraft(null); // display reverts to the stored value unless saved below
    if (!v) {
      update({ jdkPath: "" });
      return;
    }
    if (v !== s.jdkPath && (await isValidJdk(v))) update({ jdkPath: v });
  };

  return (
    <div className="h-full overflow-y-auto bg-graphite-950">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-[18px] font-semibold text-graphite-100">{t("settings.title")}</h1>
        <p className="mt-1 text-[13px] text-graphite-400">{t("settings.subtitle")}</p>

        <Section icon={<Type size={15} className="text-ember-400" />} title={t("settings.editor.title")}>
          <Row label={t("settings.editor.fontFamily")}>
            <select
              value={s.fontFamily}
              onChange={(e) => update({ fontFamily: e.target.value })}
              className={selectClass}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.stack} value={f.stack}>
                  {f.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("settings.editor.fontSize")}>
            {numberInput(s.fontSize, (n) => update({ fontSize: n }))}
          </Row>
          <Row label={t("settings.editor.tabSize")}>
            {numberInput(s.tabSize, (n) => update({ tabSize: n }))}
          </Row>
          <Check
            label={t("settings.editor.insertSpaces")}
            checked={s.insertSpaces}
            onChange={(v) => update({ insertSpaces: v })}
          />
          <Check
            label={t("settings.editor.minimap")}
            checked={s.minimap}
            onChange={(v) => update({ minimap: v })}
          />
        </Section>

        <Section icon={<Coffee size={15} className="text-ember-400" />} title={t("settings.java.title")}>
          <Row label={t("settings.java.jdkPath")}>
            <div className="flex gap-2">
              <input
                value={jdkDraft ?? s.jdkPath}
                onChange={(e) => setJdkDraft(e.target.value)}
                onBlur={() => void commitJdkDraft()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder="…"
                spellCheck={false}
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                onClick={() => void pickJdk()}
                className="shrink-0 rounded-md border border-graphite-600 px-3 py-1.5 text-[12.5px] text-graphite-200 hover:bg-graphite-700"
              >
                {t("settings.java.jdkBrowse")}
              </button>
            </div>
            <p className={hintClass}>{t("settings.java.jdkHint")}</p>
          </Row>
          <Row label={t("settings.java.xmx")}>
            <select
              value={s.javaXmx}
              onChange={(e) => update({ javaXmx: e.target.value })}
              className={selectClass}
            >
              {XMX_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {xmxLabel(v)}
                </option>
              ))}
            </select>
            <p className={hintClass}>{t("settings.java.xmxHint")}</p>
          </Row>
        </Section>

        <Section icon={<Languages size={15} className="text-ember-400" />} title={t("settings.language.title")}>
          <p className="text-[12.5px] leading-snug text-graphite-400">
            {t("settings.language.description")}
          </p>
          <Row label={t("settings.language.label")}>
            <select
              value={s.language}
              onChange={(e) => void setLanguage(e.target.value)}
              className={selectClass}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section icon={<Languages size={15} className="text-ember-400" />} title={t("settings.general.title")}>
          <Check
            label={t("settings.general.reopen")}
            checked={s.reopenLastProject}
            onChange={(v) => update({ reopenLastProject: v })}
          />
        </Section>

        <UpdateSettingsSection />

      </div>
    </div>
  );
}

function UpdateSettingsSection() {
  const t = useT();
  const status = useUpdaterStore((s) => s.status);
  const checking = useUpdaterStore((s) => s.checking);
  const check = useUpdaterStore((s) => s.check);
  const notifyError = useUiStore((st) => st.notifyError);

  const manualCheck = async () => {
    await check(true);
    const s = useUpdaterStore.getState().status;
    if (s && !s.ok) notifyError(s.error ?? t("update.checkFailed"));
  };

  return (
    <Section icon={<RefreshCw size={15} className="text-ember-400" />} title={t("update.sectionTitle")}>
      <p className="text-[12.5px] leading-snug text-graphite-400">
        {status?.currentVersion
          ? t("update.currentVersion", { version: status.currentVersion })
          : t("update.description")}
      </p>
      {status?.updateAvailable && status.latestVersion ? (
        <p className="text-[12.5px] font-medium text-ember-400">
          {t("update.available", { version: status.latestVersion })}
        </p>
      ) : status && status.ok && status.latestVersion ? (
        <p className="text-[12.5px] text-graphite-400">{t("update.upToDate")}</p>
      ) : null}
      <div>
        <button
          onClick={() => void manualCheck()}
          disabled={checking}
          className="rounded-md border border-graphite-600 px-3 py-1.5 text-[12.5px] text-graphite-200 hover:bg-graphite-700 disabled:opacity-50"
        >
          {checking ? t("update.checking") : t("update.checkNow")}
        </button>
      </div>
    </Section>
  );
}
