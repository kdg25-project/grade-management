"use client";

import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload } from "lucide-react";

type CsvUploadCardProps = {
  disabled?: boolean;
  label: string;
  loaded?: boolean;
  loading?: boolean;
  selectedFileName?: string | null;
  onInvalidSelection: () => void;
  onSelectFile: (file: File) => void;
};

export function CsvUploadCard({ disabled = false, label, loaded = false, loading = false, selectedFileName, onInvalidSelection, onSelectFile }: CsvUploadCardProps) {
  const inputId = useId();
  const [dragActive, setDragActive] = useState(false);

  const selectFiles = (files: FileList | File[]) => {
    if (disabled) return;
    const selected = Array.from(files);
    if (selected.length !== 1) {
      onInvalidSelection();
      return;
    }
    onSelectFile(selected[0]);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files) selectFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    selectFiles(event.dataTransfer.files);
  };

  return <label className={`csvUploadCard${dragActive ? " csvUploadCard-dragActive" : ""}${disabled ? " csvUploadCard-disabled" : ""}`} htmlFor={inputId} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
    <Upload aria-hidden="true" className="csvUploadIcon" />
    <span className="csvUploadTitle">CSVファイルをドラッグ＆ドロップ</span>
    <span className="csvUploadOr">または</span>
    <span className="csvUploadChoose">ファイルを選択</span>
    <span className="csvUploadHelp">CSV（UTF-8）を1件選択してください。</span>
    <input id={inputId} className="csvUploadInput" type="file" accept=".csv,text/csv" aria-label={label} disabled={disabled} onChange={handleChange} />
    <span className="csvUploadStatus" aria-live="polite" role={loading ? "status" : undefined}>{loading ? "CSVを読み込んでいます…" : selectedFileName ? <><strong>選択中:</strong> {selectedFileName}{loaded ? <><br />CSVを読み込みました。</> : null}</> : "ファイルを選択していません。"}</span>
  </label>;
}
