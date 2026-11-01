import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { collectionOf, collections, type Track } from "./types";

export function SoundChoice({ tracks, value, disabled, error, onChange }: {
  tracks: Track[]; value: string; disabled: boolean; error?: string; onChange: (value: string) => void;
}) {
  const [open,setOpen]=useState(false), [query,setQuery]=useState("");
  const trigger=useRef<HTMLButtonElement>(null), search=useRef<HTMLInputElement>(null);
  const selected=tracks.find(track=>track.id===value);
  const choices=tracks.filter(track=>track.alarmEligible!==false && `${track.title} ${track.category || ""} ${track.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  useLayoutEffect(()=>{if(open)search.current?.focus();},[open]);
  function close(){setOpen(false);trigger.current?.focus();}
  return <div className="sound-choice field row-field">
    <span id="alarm-sound-label">Sound</span>
    <button ref={trigger} id="alarm-track" name="trackId" type="button" className="sound-choice-trigger" disabled={disabled} aria-labelledby="alarm-sound-label alarm-sound-value"
      aria-expanded={open} aria-controls="alarm-sound-options" aria-invalid={Boolean(error)} aria-describedby={error?"trackId-error alarm-source-help":"alarm-source-help"}
      onClick={()=>{setQuery("");setOpen(v=>!v);}}><span id="alarm-sound-value">{selected?.title || (value?"Selection No Longer Available":"Choose a Sound")}</span><ChevronRight size={17} aria-hidden="true"/></button>
    {open && <div id="alarm-sound-options" className="sound-choice-options" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}}}>
      <div className="sound-choice-search"><label className="sr-only" htmlFor="alarm-sound-search">Search Alarm Sounds</label>
        <input ref={search} id="alarm-sound-search" name="alarm-sound-search" type="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" placeholder="Search sounds…" value={query} disabled={disabled}
          onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}}/>
        {query && <button className="key" type="button" aria-label="Clear sound search" onClick={()=>{setQuery("");search.current?.focus();}}><X size={16} aria-hidden="true"/></button>}
      </div>
      <p className="sr-only" role="status">{choices.length} sounds found.</p>
      <div className="sound-choice-results">
        {collections.filter(group=>group.id!=="all").map(group=>{
          const items=choices.filter(track=>collectionOf(track)===group.id);
          return items.length?<section key={group.id} aria-label={group.title}><h3>{group.title}</h3><ul>{items.map(track=><li key={track.id}><button type="button" disabled={disabled} aria-pressed={track.id===value} onClick={()=>{onChange(track.id);close();}}><span>{track.title}</span>{track.id===value&&<Check size={18} aria-hidden="true"/>}</button></li>)}</ul></section>:null;
        })}
        {!choices.length&&<p className="hint">No sounds found. Try a different search.</p>}
      </div>
    </div>}
  </div>;
}

const splitTags=(text:string)=>text.split(/[,;\t\r\n]+/).map(tag=>tag.trim()).filter(Boolean);
const uniqueTags=(tags:string[])=>tags.filter((tag,index)=>tags.findIndex(other=>other.toLocaleLowerCase()===tag.toLocaleLowerCase())===index);
export function TagEntry({ suggestions, disabled, error, onDirty }: { suggestions:string[];disabled:boolean;error?:string;onDirty:()=>void }) {
  const [tags,setTags]=useState<string[]>([]), [draft,setDraft]=useState("");
  const [localError,setLocalError]=useState("");
  const input=useRef<HTMLTextAreaElement>(null);
  const all=uniqueTags([...tags,...splitTags(draft)]);
  const options=uniqueTags(suggestions).filter(tag=>!tags.some(t=>t.toLowerCase()===tag.toLowerCase()) && tag.toLowerCase().includes(draft.trim().toLowerCase())).slice(0,6);
  function add(text:string){
    const next=uniqueTags([...tags,...splitTags(text)]);
    if(next.length>20 || next.some(tag=>tag.length>60) || next.join(",").length>1000){setLocalError("Use up to 20 tags, 60 characters each, within 1,000 characters total.");return;}
    setTags(next);setDraft("");setLocalError("");onDirty();
  }
  return <div className="field row-field stacked tag-field">
    <label htmlFor="upload-tags">Tags <span className="optional">Optional</span></label>
    <input type="hidden" name="tags" value={all.join(",")}/>
    {tags.length>0&&<ul className="tag-chips" aria-label="Added tags">{tags.map(tag=><li key={tag}><span>{tag}</span><button type="button" disabled={disabled} aria-label={`Remove tag ${tag}`} onClick={()=>{setTags(tags.filter(t=>t!==tag));setLocalError("");onDirty();input.current?.focus();}}><X size={14} aria-hidden="true"/></button></li>)}</ul>}
    <div className="tag-draft"><textarea ref={input} id="upload-tags" name="tagsDraft" rows={1} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" placeholder="Add a tag…" value={draft} disabled={disabled}
      aria-invalid={Boolean(error||localError)} aria-describedby={`tags-help${error?" tags-error":""}${localError?" tags-local-error":""}`}
      onChange={event=>{const value=event.target.value;setDraft(value);setLocalError("");onDirty();if(!(event.nativeEvent as InputEvent).isComposing && /[,;\t\r\n]/.test(value))add(value);}}
      onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();add(draft);event.currentTarget.blur();}}}/>
      <button className="key" type="button" disabled={disabled||!draft.trim()} onClick={()=>{add(draft);input.current?.focus();}}>Add</button></div>
    {options.length>0&&<div className="tag-suggestions" role="group" aria-label="Suggested tags">{options.map(tag=><button className="key" type="button" key={tag} disabled={disabled} onClick={()=>{add(tag);input.current?.focus();}}>{tag}</button>)}</div>}
    <small id="tags-help">Up to 20 tags. Paste commas, tabs or new lines.</small>
    {error&&<span className="field-error" id="tags-error">{error}</span>}
    {localError&&<span className="field-error" id="tags-local-error" role="alert">{localError}</span>}
  </div>;
}
