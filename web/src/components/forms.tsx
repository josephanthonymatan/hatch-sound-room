"use client";
import { EntryRange, nextField } from "./data-entry";
import { SoundChoice, TagEntry } from "./form-data-entry";
import { haptic } from "./haptics";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Check, ChevronRight, Disc3, X } from "lucide-react";
import { ClockFace } from "./artwork";
import { BusyIcon } from "./busy-icon";
import { AlarmFadeWheel } from "./alarm-fade-wheel";
import type { FormResult, UpdateScope } from "./room-state";
import {
  alarmDays,
  api,
  jsonRequest,
  percentage,
  repeatLabel,
  timeParts,
  trackTiming,
  weekdayName,
  type Alarm,
  type Track,
} from "./types";

type FormProps = {
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onMutationStart: (scope: UpdateScope) => () => void;
  onSuccess: (message: string, result: FormResult) => Promise<void>;
};
type Errors = Record<string, string>;

function FieldError({ name, errors }: { name: string; errors: Errors }) {
  return errors[name] ? (
    <span id={`${name}-error`} className="field-error">
      {errors[name]}
    </span>
  ) : null;
}

function ValidationSummary({ errors }: { errors: Errors }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {Object.values(errors).join(" ")}
    </p>
  );
}

function focusError(form: HTMLFormElement, errors: Errors) {
  const first = Object.keys(errors)[0];
  const input = first === "tags" ? form.querySelector("#upload-tags") : form.elements.namedItem(first);
  if (input instanceof HTMLElement) input.focus();
}

/* A modal sheet: native <dialog> supplies focus containment and Escape. */
export function Sheet({
  titleId,
  onClose,
  busy,
  children,
}: {
  titleId: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    document.getElementById(titleId)?.focus();
    document.documentElement.classList.add("sheet-open");
    return () => {
      document.documentElement.classList.remove("sheet-open");
      if (node?.open) node.close();
    };
  }, [titleId]);
  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}

function SheetBar({
  titleId,
  title,
  submitLabel,
  onClose,
  busy,
}: {
  titleId: string;
  title: string;
  submitLabel: string;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="sheet-bar">
      <span className="sheet-grabber" aria-hidden="true" />
      <button
        type="button"
        className="sheet-icon"
        disabled={busy}
        onClick={onClose}
        aria-label={`Close ${title}`}
      >
        <X size={22} aria-hidden="true" />
      </button>
      <h2 id={titleId} tabIndex={-1}>
        {title}
      </h2>
      <button
        type="submit"
        className="sheet-icon"
        disabled={busy}
        aria-label={submitLabel}
      >
        {busy ? <BusyIcon size={20} /> : <Check size={22} aria-hidden="true" />}
      </button>
    </div>
  );
}

function CategoryField({ categories, busy, errors, prefix }: {
  categories: string[]; busy: boolean; errors: Errors; prefix: string;
}) {
  const [selection, setSelection] = useState("");
  return (
    <>
      <div className="field row-field stacked">
        <label htmlFor={`${prefix}-category`}>Category</label>
        <select id={`${prefix}-category`} name="category" autoComplete="off" required
          value={selection} onChange={(event) => setSelection(event.target.value)} disabled={busy}
          aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? "category-error" : undefined}>
          <option value="" disabled>Choose a Category…</option>
          {categories.map((category) => <option key={category} value={`category:${category}`}>{category}</option>)}
          <option value="__new__">Create New Category…</option>
        </select>
        <FieldError name="category" errors={errors} />
      </div>
      {selection === "__new__" && (
        <div className="field row-field stacked">
          <label htmlFor={`${prefix}-new-category`}>New Category Name</label>
          <input id={`${prefix}-new-category`} name="newCategory" autoComplete="off" autoCapitalize="words" autoCorrect="on" enterKeyHint="next" onKeyDown={nextField} required
            maxLength={60} placeholder="e.g., Music…" disabled={busy}
            aria-invalid={Boolean(errors.newCategory)} aria-describedby={errors.newCategory ? "newCategory-error" : undefined} />
          <FieldError name="newCategory" errors={errors} />
        </div>
      )}
    </>
  );
}

function readCategory(data: FormData, errors: Errors) {
  const creating = data.get("category") === "__new__";
  const selected = String(data.get("category") || "");
  const category = (creating ? String(data.get("newCategory") || "") : selected.startsWith("category:") ? selected.slice(9) : "").trim();
  if (!category || category.length > 60)
    errors[creating ? "newCategory" : "category"] = creating
      ? "Enter a category name of up to 60 characters."
      : "Choose a category or create a new one.";
  return category;
}

export function UploadForm({ categories, tagSuggestions, onClose, onDirty, onMutationStart, onSuccess }: FormProps & { categories: string[]; tagSuggestions: string[] }) {
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [title,setTitle] = useState("");
  const titleEdited = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const next: Errors = {};
    const file = data.get("file");
    if (!(file instanceof File) || !file.size)
      next.file = "Choose an MP3 or WAV file to upload.";
    else if (!/\.(mp3|wav)$/i.test(file.name))
      next.file = "Choose an MP3 or WAV file. Other formats are not supported.";
    else if (file.size > 50 * 1024 * 1024)
      next.file =
        "Choose a file smaller than 50 MiB. Export a shorter or smaller MP3 and try again.";
    if (!String(data.get("title") || "").trim())
      next.title = "Give this sound a title.";
    const category = readCategory(data, next);
    const tags = String(data.get("tags") || "");
    const parsedTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length > 1000)
      next.tags = "Keep the tags field within 1,000 characters.";
    else if (
      parsedTags.length > 20 ||
      parsedTags.some((tag) => tag.length > 60)
    )
      next.tags =
        "Use up to 20 tags, with no more than 60 characters in each tag.";
    if (String(data.get("license") || "").length > 1000)
      next.license = "Keep source and rights notes within 1,000 characters.";
    setErrors(next);
    setError("");
    if (Object.keys(next).length) {
      haptic("error");
      focusError(form, next);
      return;
    }
    data.set("title", String(data.get("title")).trim());
    data.delete("tagsDraft");
    data.set("category", category);
    data.delete("newCategory");
    if (!tags.trim()) data.delete("tags");
    if (!String(data.get("license") || "").trim()) data.delete("license");
    setBusy(true);
    const finish = onMutationStart("library");
    try {
      const result = await api<{ track: Track }>("/library", { method: "POST", body: data });
      onDirty(false);
      await onSuccess("Your sound was uploaded and added to the collection.", result);
    } catch (cause) {
      haptic("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "The upload failed. Try again.",
      );
    } finally {
      finish();
      setBusy(false);
    }
  }

  return (
    <Sheet titleId="upload-title-heading" onClose={onClose} busy={busy}>
      <form onSubmit={submit} onChange={() => onDirty(true)} noValidate>
        <SheetBar
          titleId="upload-title-heading"
          title="Upload a Sound"
          submitLabel="Add Sound"
          onClose={onClose}
          busy={busy}
        />
        <ValidationSummary errors={errors} />
        <div className="field file-field">
          <input
            id="upload-file"
            required
            name="file"
            type="file"
            autoComplete="off"
            accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
            aria-invalid={Boolean(errors.file)}
            aria-describedby={
              errors.file ? "file-error file-help" : "file-help"
            }
            onChange={(event) => {
              const filename=event.target.files?.[0]?.name || "";
              setFileName(filename);
              if(!titleEdited.current)setTitle(filename.replace(/\.(mp3|wav)$/i,"").replace(/[_-]+/g," ").trim().slice(0,180));
            }}
            disabled={busy}
          />
          <label
            htmlFor="upload-file"
            className={`record-slot ${fileName ? "has-file" : ""}`}
          >
            <span className="record-slot-disc" aria-hidden="true">
              <Disc3 size={30} />
            </span>
            <span className="record-slot-text">
              <strong>{fileName || "Choose an Audio File"}</strong>
              <small id="file-help">
                MP3 or WAV · up to 50&nbsp;MiB · 1&nbsp;second to
                30&nbsp;minutes
              </small>
            </span>
          </label>
          <FieldError name="file" errors={errors} />
        </div>
        <div className="row-group">
          <div className="field row-field stacked">
            <label htmlFor="upload-title">Title</label>
            <input
              id="upload-title"
              value={title} onChange={event=>{titleEdited.current=true;setTitle(event.target.value);}}
              autoCapitalize="words" autoCorrect="on" enterKeyHint="next" onKeyDown={nextField}
              required
              name="title"
              autoComplete="off"
              placeholder="e.g., Rain at the Window…"
              maxLength={180}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? "title-error" : undefined}
              disabled={busy}
            />
            <FieldError name="title" errors={errors} />
          </div>
          <CategoryField categories={categories} busy={busy} errors={errors} prefix="upload" />
          <div className="field row-field">
            <label htmlFor="upload-kind">Type</label>
            <select
              id="upload-kind"
              name="kind"
              autoComplete="off"
              defaultValue="music"
              disabled={busy}
            >
              <option value="music">Music</option>
              <option value="field-recording">Field Recording</option>
              <option value="generated">Generated Audio (Your File)</option>
            </select>
          </div>
          <TagEntry suggestions={tagSuggestions} disabled={busy} error={errors.tags} onDirty={()=>onDirty(true)}/>
          <div className="field row-field stacked">
            <label htmlFor="upload-license">
              Source & Rights <span className="optional">Optional</span>
            </label>
            <input
              id="upload-license"
              name="license" autoCapitalize="sentences" autoCorrect="on" enterKeyHint="done"
              autoComplete="off"
              maxLength={1000}
              placeholder="e.g., Your recording, public domain…"
              aria-invalid={Boolean(errors.license)}
              aria-describedby={
                errors.license ? "license-error license-help" : "license-help"
              }
              disabled={busy}
            />
            <small id="license-help">
              Note the source or permission to use it.
            </small>
            <FieldError name="license" errors={errors} />
          </div>
        </div>
        <div className="sheet-foot">
          <button
            className="key key-ink key-wide"
            disabled={busy}
            type="submit"
          >
            {busy ? (
              <>
                <BusyIcon size={16} /> Uploading…
              </>
            ) : (
              "Add Sound"
            )}
          </button>
          <p>Audio is prepared for playback on your Hatch.</p>
          <p className="form-error" role="status" aria-live="polite">
            {error}
          </p>
        </div>
      </form>
    </Sheet>
  );
}

export function SaveSoundForm({
  categories,
  captureKey,
  title,
  onClose,
  onDirty,
  onMutationStart,
  onSuccess,
}: FormProps & { categories: string[]; captureKey: string | null; title: string }) {
  const [key] = useState(captureKey);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const next: Errors = title ? {} : { title: "Give this sound a name." };
    const category = readCategory(data, next);
    setErrors(next);
    if (Object.keys(next).length) {
      haptic("error");
      focusError(form, next);
      return;
    }
    if (!key) {
      haptic("error");
      setError(
        "Play a sound in the Hatch app, then close this sheet, refresh the room, and save it here.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const finish = onMutationStart("library");
    try {
      const result = await api<{ existing: boolean; track: Track }>(
        "/sounds/save-current",
        jsonRequest("POST", { title, category, captureKey: key }),
      );
      onDirty(false);
      await onSuccess(
        result.existing
          ? "This sound is already in Saved. Its category was updated."
          : "The current Hatch sound was added to Saved.",
        result,
      );
    } catch (cause) {
      haptic("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "The sound could not be saved. Refresh the room and try again.",
      );
    } finally {
      finish();
      setBusy(false);
    }
  }
  return (
    <Sheet titleId="save-sound-heading" onClose={onClose} busy={busy}>
      <form onSubmit={submit} onChange={() => onDirty(true)} noValidate>
        <SheetBar
          titleId="save-sound-heading"
          title="Save Current Sound"
          submitLabel="Save Sound"
          onClose={onClose}
          busy={busy}
        />
        <ValidationSummary errors={errors} />
        <p className="sheet-intro">
          Save the sound currently playing on your Hatch. This keeps its
          original timer, without saving the favorite’s light or volume.
        </p>
        {!key && (
          <p className="sheet-intro">
            Start a sound in the Hatch app, then refresh Sound Room. Uploaded
            audio is already in your collection.
          </p>
        )}
        <div className="row-group">
          <div className="field row-field stacked">
            <label htmlFor="saved-sound-title">Name</label>
            <input
              id="saved-sound-title"
              name="title" autoCapitalize="words" autoCorrect="on" enterKeyHint="next" onKeyDown={nextField}
              autoComplete="off"
              defaultValue={key ? title : ""}
              placeholder="e.g., Rain for Reading…"
              maxLength={180}
              required
              disabled={busy}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? "title-error" : undefined}
            />
            <FieldError name="title" errors={errors} />
          </div>
          <CategoryField categories={categories} busy={busy} errors={errors} prefix="saved-sound" />
        </div>
        <div className="sheet-foot">
          <button
            type="submit"
            className="key key-ink key-wide"
            disabled={busy}
          >
            {busy ? (
              <>
                <BusyIcon size={16} /> Saving…
              </>
            ) : (
              "Save Sound"
            )}
          </button>
          <p>
            Saving leaves playback as it is. Check the saved sound on your Hatch
            before using it for an alarm.
          </p>
          <p className="form-error" role="status" aria-live="polite">
            {error}
          </p>
        </div>
      </form>
    </Sheet>
  );
}

export function AlarmForm({
  tracks,
  alarm,
  onClose,
  onDirty,
  onMutationStart,
  onSuccess,
}: FormProps & { tracks: Track[]; alarm?: Alarm }) {
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [zone] = useState(() => alarm?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [volume, setVolume] = useState(alarm?.volume ?? 30);
  const [brightness, setBrightness] = useState(alarm?.light.to ?? 75);
  const [fade, setFade] = useState((alarm?.light.rampSeconds ?? 15) / 60);
  const [repeatDays, setRepeatDays] = useState<number[]>(alarm?.repeatDays || []);
  const [trackId, setTrackId] = useState(() => alarm?.trackId || tracks.find((track) => track.id === "hatch-sound-10514" && track.alarmEligible !== false)?.id || tracks.find((track) => track.alarmEligible !== false)?.id || "");
  const selectedTrack = tracks.find((track) => track.id === trackId);
  const favorite = selectedTrack?.kind === "hatch-favorite";
  const [time, setTime] = useState(() => {
    if (alarm?.localTime) return alarm.localTime;
    if (alarm) {
      const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: alarm.timeZone }).formatToParts(new Date(alarm.scheduledAt));
      return `${parts.find((part) => part.type === "hour")?.value || "07"}:${parts.find((part) => part.type === "minute")?.value || "00"}`;
    }
    return "07:00";
  });
  const [hour, minute] = /^\d{2}:\d{2}$/.test(time) ? time.split(":").map(Number) : [null, null];
  const preview = hour === null ? null : timeParts(new Date(2000, 0, 1, hour, minute ?? 0));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const precision = form.querySelector<HTMLInputElement>(".precise-editor input");
    if (precision) { setError("Tap Done to finish the precise value before saving."); precision.focus(); return; }
    const data = new FormData(form);
    const next: Errors = {};
    if (!selectedTrack || selectedTrack.alarmEligible === false)
      next.trackId = "Choose an available sound for this alarm.";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) next.time = "Choose a valid alarm time.";
    if ((!Number.isFinite(fade) || fade < 0 || fade > 3 || !Number.isInteger(fade * 4)) && fade * 60 !== alarm?.light.rampSeconds) next.fade = "Choose Off or a 15-second step up to 3 minutes.";
    setErrors(next);
    setError("");
    if (Object.keys(next).length) {
      haptic("error");
      focusError(form, next);
      return;
    }
    setBusy(true);
    const finish = onMutationStart("alarms");
    try {
      const result = await api<{ alarm: Alarm }>(alarm ? `/alarms/${encodeURIComponent(alarm.id)}` : "/alarms", jsonRequest(alarm ? "PATCH" : "POST", {
        label: String(data.get("label") || "").trim(),
        localTime: time,
        repeatDays,
        timeZone: zone,
        trackId,
        volume,
        light: { color: data.get("color") || alarm?.light.color || "#ff8800", from: 0, to: brightness, rampSeconds: Math.round(fade * 60) },
      }));
      onDirty(false);
      await onSuccess("Your alarm was saved.", result);
    } catch (cause) {
      haptic("error");
      setError(cause instanceof Error ? cause.message : "The alarm could not be saved. Try again.");
    } finally { finish(); setBusy(false); }
  }

  async function remove() {
    if (!alarm || !window.confirm(`Delete ${alarm.label ? `“${alarm.label}”` : "this alarm"}? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    const finish = onMutationStart("alarms");
    try {
      await api(`/alarms/${encodeURIComponent(alarm.id)}`, jsonRequest("DELETE"));
      onDirty(false);
      await onSuccess("Your alarm was deleted.", { deletedAlarmId: alarm.id });
    } catch (cause) {
      haptic("error");
      setError(cause instanceof Error ? cause.message : "The alarm could not be deleted. Try again.");
    } finally { finish(); setBusy(false); }
  }

  return (
    <Sheet titleId="alarm-title-heading" onClose={onClose} busy={busy}>
      <form className="alarm-form" onSubmit={submit} onChange={() => onDirty(true)} noValidate>
        <SheetBar titleId="alarm-title-heading" title={alarm ? "Edit Alarm" : "New Alarm"} submitLabel="Save Alarm" onClose={onClose} busy={busy} />
        <ValidationSummary errors={errors} />
        <div className="alarm-preview" aria-hidden="true">
          <ClockFace hours={hour} minutes={minute} />
          <div className="digit-capsules">
            {preview ? <>
              {[...preview.time].map((char, index) => /\d/.test(char)
                ? <span key={index} className="capsule">{char}</span>
                : <span key={index} className="capsule-sep">{char}</span>)}
              {preview.period && <span className="capsule-period">{preview.period}</span>}
            </> : <span className="capsule capsule-empty">--</span>}
          </div>
        </div>
        <div className="row-group">
          <div className="field row-field">
            <label htmlFor="alarm-time">Time</label>
            <input id="alarm-time" required name="time" type="time" autoComplete="off" value={time}
              onChange={(event) => setTime(event.target.value)} disabled={busy} aria-invalid={Boolean(errors.time)}
              aria-describedby={errors.time ? "time-error time-zone" : "time-zone"} />
            <FieldError name="time" errors={errors} />
          </div>
          <details className="alarm-repeat">
            <summary><span>Repeat</span><span className="repeat-value">{repeatLabel(repeatDays)}<ChevronRight size={17} aria-hidden="true" /></span></summary>
            <fieldset disabled={busy}>
              <legend className="sr-only">Repeat on These Days</legend>
              {alarmDays.map((day) => <label key={day} className="repeat-day">
                <span>{weekdayName(day, "long")}</span>
                <input type="checkbox" name="repeatDays" value={day} autoComplete="off" checked={repeatDays.includes(day)}
                  onChange={(event) => setRepeatDays((days) => event.target.checked ? [...days, day] : days.filter((value) => value !== day))} />
                <Check size={19} aria-hidden="true" />
              </label>)}
            </fieldset>
          </details>
          <div className="field row-field">
            <label htmlFor="alarm-label">Name <span className="optional">Optional</span></label>
            <input id="alarm-label" name="label" autoComplete="off" autoCapitalize="words" autoCorrect="on" enterKeyHint="done" onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}} placeholder="Alarm…" maxLength={180} defaultValue={alarm?.label || ""} disabled={busy} />
          </div>
          <div className="alarm-sound-field">
            <SoundChoice tracks={tracks} value={trackId} disabled={busy} error={errors.trackId} onChange={id=>{setTrackId(id);onDirty(true);}}/>
            <small id="alarm-source-help" aria-live="polite">{favorite
              ? "Uses the favorite’s saved light, volume & timing. Turn Hatch off before the alarm. Resave here after changing the favorite in Hatch."
              : selectedTrack ? trackTiming(selectedTrack) : "Choose a sound from your collection."}</small>
            <FieldError name="trackId" errors={errors} />
          </div>
        </div>
        {!favorite && <div className="row-group">
          <div className="field row-field range-field"><EntryRange id="alarm-volume" label="Volume" value={volume} display={percentage(volume)} disabled={busy} onChange={v=>{setVolume(v);onDirty(true);}}/></div>
          <div className="field row-field range-field"><EntryRange id="alarm-brightness" label="Brightness" value={brightness} display={percentage(brightness)} disabled={busy} onChange={v=>{setBrightness(v);onDirty(true);}}/></div>
          <div className="field row-field">
            <label htmlFor="alarm-color">Light Color</label>
            <span className="color-well color-well-small"><input id="alarm-color" name="color" type="color" autoComplete="off" translate="no" defaultValue={alarm?.light.color || "#ff8800"} disabled={busy} /></span>
          </div>
          <div className="field row-field fade-field">
            <span id="alarm-fade-label">Light Fade</span>
            <AlarmFadeWheel value={fade} disabled={busy} onChange={(value) => { setFade(value); onDirty(true); }} />
            <small id="fade-help">Light brightens from off after the alarm starts.</small>
          </div>
        </div>}
        <div className="sheet-foot">
          <button className="key key-blue key-wide" disabled={busy} type="submit">{busy ? <><BusyIcon size={16} /> Saving…</> : "Save Alarm"}</button>
          {alarm && <button className="alarm-delete" type="button" disabled={busy} onClick={() => void remove()}>Delete Alarm</button>}
          <p id="time-zone"><span translate="no">{zone}</span> · Hold the top of your Hatch for about 3&nbsp;seconds to stop.</p>
          <p className="form-error" role="status" aria-live="polite">{error}</p>
        </div>
      </form>
    </Sheet>
  );
}
