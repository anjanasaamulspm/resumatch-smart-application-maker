import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Copy, FileText, FileType2, FileDown, Mail, Check, Loader2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { generateApplication } from "@/lib/dify.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ResuMatch AI — Tailored Resumes & Cover Letters" },
      {
        name: "description",
        content:
          "Paste your resume and a job description. ResuMatch AI generates a tailored resume and a custom cover letter in seconds.",
      },
      { property: "og:title", content: "ResuMatch AI" },
      {
        property: "og:description",
        content: "AI-powered tailored resumes and cover letters for any role.",
      },
    ],
  }),
  component: Home,
});

const ROLES = [
  "Product Manager",
  "Software Engineer",
  "Data Analyst",
  "Data Scientist",
  "Designer (UX/UI)",
  "Marketing Manager",
  "Sales Executive",
  "Project Manager",
  "Other",
];

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMd(s: string) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function markdownTextToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    const ol = /^\s*\d+\.\s+/.exec(line);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMd(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      closeList();
      html.push("<hr/>");
      continue;
    }
    closeList();
    html.push(`<p>${inlineMd(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}



function Home() {
  const [role, setRole] = useState<string>("");
  const [customRole, setCustomRole] = useState("");
  const [resume, setResume] = useState("");
  const [resumeMode, setResumeMode] = useState<"paste" | "upload">("paste");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [jd, setJd] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ resume: string; letter: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const effectiveRole = role === "Other" ? customRole.trim() : role;
  const canGenerate =
    !!effectiveRole && resume.trim().length > 0 && jd.trim().length > 0 && !loading && !parsing;

  const callDify = useServerFn(generateApplication);

  const parseFile = async (file: File): Promise<string> => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      const pdfjs: any = await import("pdfjs-dist");
      const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url" as any)).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it: any) => it.str).join(" ") + "\n\n";
      }
      return text.trim();
    }
    if (name.endsWith(".docx")) {
      const mammoth: any = await import("mammoth/mammoth.browser" as any);
      const buf = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
      return value.trim();
    }
    if (name.endsWith(".txt")) {
      return (await file.text()).trim();
    }
    throw new Error("Unsupported file type. Use PDF, DOCX, or TXT.");
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setUploadedFile(file);
    try {
      const text = await parseFile(file);
      if (!text) throw new Error("No text could be extracted from the file.");
      setResume(text);
      toast.success(`Parsed ${file.name}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to parse file.");
      setUploadedFile(null);
      setResume("");
    } finally {
      setParsing(false);
    }
  };


  const handleGenerate = async () => {
    if (!canGenerate) {
      toast.error("Fill in role, resume, and job description first.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const out = await callDify({
        data: {
          targetRole: effectiveRole,
          currentResume: resume,
          jobDescription: jd,
        },
      });
      if (!out.tailored_resume && !out.cover_letter) {
        throw new Error("Empty response from Dify workflow");
      }
      setResult({ resume: out.tailored_resume, letter: out.cover_letter });
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to generate. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 1500);
  };

  const handleDownloadText = (text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/plain" });
    triggerDownload(blob, filename);
    toast.success("Text file downloaded");
  };

  const handleDownloadWord = (text: string, filename: string) => {
    const html = markdownTextToHtml(text);
    const doc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export</title></head><body>${html}</body></html>`;
    const blob = new Blob(["\ufeff", doc], { type: "application/msword" });
    triggerDownload(blob, filename);
    toast.success("Word file downloaded");
  };

  const handleDownloadPdf = async (text: string, filename: string) => {
    const html2pdf = (await import("html2pdf.js")).default;
    const container = document.createElement("div");
    container.style.cssText =
      "padding:48px;font-family:Georgia,'Times New Roman',serif;color:#0f172a;font-size:12pt;line-height:1.55;background:#ffffff;max-width:780px;";
    container.innerHTML = `<style>
      h1{font-size:22pt;margin:0 0 10px;color:#0b1e3f;}
      h2{font-size:15pt;margin:18px 0 6px;color:#0b1e3f;border-bottom:1px solid #e2e8f0;padding-bottom:4px;}
      h3{font-size:12.5pt;margin:14px 0 4px;color:#0b1e3f;}
      p{margin:6px 0;}
      ul,ol{margin:6px 0 6px 22px;}
      li{margin:3px 0;}
      strong{color:#0b1e3f;}
      hr{border:none;border-top:1px solid #e2e8f0;margin:12px 0;}
      a{color:#2563eb;text-decoration:none;}
    </style>${markdownTextToHtml(text)}`;
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:fixed;left:-10000px;top:0;";
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
    try {
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        } as any)
        .from(container)
        .save();
      toast.success("PDF downloaded");
    } finally {
      document.body.removeChild(wrapper);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy text-primary-foreground">
              <Sparkles className="h-5 w-5 text-primary-glow" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-navy">
              ResuMatch <span className="text-primary">AI</span>
            </span>
          </div>
          <Button variant="outline" className="border-navy/20 text-navy hover:bg-navy hover:text-primary-foreground">
            Login / Sign Up
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pt-10 pb-6 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            AI-tailored applications in seconds
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-navy sm:text-5xl">
            Land the interview with a resume{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              built for the role
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Paste your current resume and the job description. ResuMatch AI rewrites them into a
            tailored resume and a custom cover letter — keyword-matched and recruiter-ready.
          </p>
        </div>
      </section>

      {/* Main split */}
      <main className="mx-auto grid max-w-7xl gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-2 lg:px-8">
        {/* Inputs */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-navy">Your inputs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Three quick fields. We handle the rest.
          </p>

          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="role" className="text-navy">
                Target role type
              </Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="role" className="h-11">
                  <SelectValue placeholder="Select a target role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {role === "Other" && (
                <div className="animate-fade-in-up space-y-2 pt-2">
                  <Label htmlFor="customRole" className="text-navy">
                    Specify target role
                  </Label>
                  <Input
                    id="customRole"
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                    placeholder="e.g. Solutions Architect"
                    className="h-11"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-navy">Current resume</Label>
                {uploadedFile && resumeMode === "upload" && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedFile(null);
                      setResume("");
                    }}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                )}
              </div>
              <Tabs
                value={resumeMode}
                onValueChange={(v) => setResumeMode(v as "paste" | "upload")}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="paste">Paste Text</TabsTrigger>
                  <TabsTrigger value="upload">Upload File (PDF/Docx)</TabsTrigger>
                </TabsList>
                <TabsContent value="paste" className="mt-3">
                  <Textarea
                    id="resume"
                    value={resume}
                    onChange={(e) => setResume(e.target.value)}
                    placeholder="Paste the full text of your resume here..."
                    className="min-h-[180px] resize-y"
                  />
                </TabsContent>
                <TabsContent value="upload" className="mt-3">
                  <label
                    htmlFor="resume-file"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) void handleFile(f);
                    }}
                    className={`flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                      dragOver
                        ? "border-primary bg-primary/5"
                        : "border-border bg-secondary/40 hover:border-primary/50 hover:bg-secondary/60"
                    }`}
                  >
                    {parsing ? (
                      <>
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Parsing file…</p>
                      </>
                    ) : uploadedFile ? (
                      <>
                        <FileText className="h-6 w-6 text-primary" />
                        <p className="text-sm font-medium text-navy">{uploadedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {resume.length.toLocaleString()} characters extracted · click to replace
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload className="h-6 w-6 text-primary" />
                        <p className="text-sm font-medium text-navy">
                          Drag &amp; drop, or click to upload
                        </p>
                        <p className="text-xs text-muted-foreground">PDF, DOCX, or TXT</p>
                      </>
                    )}
                    <input
                      id="resume-file"
                      type="file"
                      accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </TabsContent>
              </Tabs>
            </div>


            <div className="space-y-2">
              <Label htmlFor="jd" className="text-navy">
                Paste target job description
              </Label>
              <Textarea
                id="jd"
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                placeholder="Paste the full job description here..."
                className="min-h-[180px] resize-y"
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="btn-electric h-12 w-full text-base font-semibold disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Generate Tailored Application
                </>
              )}
            </Button>
          </div>
        </section>

        {/* Outputs */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {loading ? (
            <LoadingState />
          ) : result ? (
            <ResultTabs
              result={result}
              copied={copied}
              onCopy={handleCopy}
              onDownloadText={handleDownloadText}
              onDownloadWord={handleDownloadWord}
              onDownloadPdf={handleDownloadPdf}
            />
          ) : (
            <EmptyState />
          )}
        </section>
      </main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-muted-foreground sm:px-6 lg:px-8">
          © {new Date().getFullYear()} ResuMatch AI. Built for job seekers who don't have time to waste.
        </div>
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[520px] flex-col items-center justify-center text-center">
      <EmptyIllustration />
      <h3 className="mt-6 font-display text-lg font-semibold text-navy">
        Your tailored application will appear here
      </h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Fill in the fields on the left and click <span className="font-medium text-primary">Generate</span>.
        You'll get a tailored resume and a custom cover letter — ready to copy or download.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Crafting your tailored application...
      </div>
      <div className="space-y-3">
        <div className="skeleton-pulse h-6 w-2/3" />
        <div className="skeleton-pulse h-4 w-full" />
        <div className="skeleton-pulse h-4 w-11/12" />
        <div className="skeleton-pulse h-4 w-10/12" />
      </div>
      <div className="space-y-3 pt-2">
        <div className="skeleton-pulse h-6 w-1/2" />
        <div className="skeleton-pulse h-4 w-full" />
        <div className="skeleton-pulse h-4 w-11/12" />
        <div className="skeleton-pulse h-4 w-9/12" />
        <div className="skeleton-pulse h-4 w-10/12" />
      </div>
      <div className="space-y-3 pt-2">
        <div className="skeleton-pulse h-6 w-1/3" />
        <div className="skeleton-pulse h-4 w-full" />
        <div className="skeleton-pulse h-4 w-11/12" />
      </div>
    </div>
  );
}

function ResultTabs({
  result,
  copied,
  onCopy,
  onDownloadText,
  onDownloadWord,
  onDownloadPdf,
}: {
  result: { resume: string; letter: string };
  copied: string | null;
  onCopy: (text: string, key: string) => void;
  onDownloadText: (text: string, filename: string) => void;
  onDownloadWord: (text: string, filename: string) => void;
  onDownloadPdf: (text: string, filename: string) => Promise<void>;
}) {
  return (
    <div className="animate-fade-in-up">
      <Tabs defaultValue="resume" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="resume" className="gap-2">
            <FileText className="h-4 w-4" />
            Tailored Resume
          </TabsTrigger>
          <TabsTrigger value="letter" className="gap-2">
            <Mail className="h-4 w-4" />
            Custom Cover Letter
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resume" className="mt-4">
          <ActionBar
            onCopy={() => onCopy(result.resume, "resume")}
            onDownloadPdf={() => onDownloadPdf(result.resume, "tailored-resume.pdf")}
            onDownloadWord={() => onDownloadWord(result.resume, "tailored-resume.doc")}
            onDownloadText={() => onDownloadText(result.resume, "tailored-resume.txt")}
            copied={copied === "resume"}
          />
          <div className="markdown-content mt-4 max-h-[520px] overflow-auto rounded-lg border border-border bg-secondary/40 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {result.resume}
            </ReactMarkdown>
          </div>
        </TabsContent>

        <TabsContent value="letter" className="mt-4">
          <ActionBar
            onCopy={() => onCopy(result.letter, "letter")}
            onDownloadPdf={() => onDownloadPdf(result.letter, "cover-letter.pdf")}
            onDownloadWord={() => onDownloadWord(result.letter, "cover-letter.doc")}
            onDownloadText={() => onDownloadText(result.letter, "cover-letter.txt")}
            copied={copied === "letter"}
          />
          <div className="markdown-content mt-4 max-h-[520px] overflow-auto rounded-lg border border-border bg-secondary/40 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {result.letter}
            </ReactMarkdown>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ActionBar({
  onCopy,
  onDownloadPdf,
  onDownloadWord,
  onDownloadText,
  copied,
}: {
  onCopy: () => void;
  onDownloadPdf: () => void | Promise<void>;
  onDownloadWord: () => void;
  onDownloadText: () => void;
  copied: boolean;
}) {
  const [busy, setBusy] = useState<null | "pdf">(null);
  const handlePdf = async () => {
    setBusy("pdf");
    try {
      await onDownloadPdf();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onCopy} className="gap-2">
        {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button
        size="sm"
        onClick={handlePdf}
        disabled={busy === "pdf"}
        className="gap-2 bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-sm hover:opacity-95"
      >
        {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        Download PDF
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onDownloadWord}
        className="gap-2 border-navy/20 text-navy hover:bg-navy hover:text-primary-foreground"
      >
        <FileType2 className="h-4 w-4" />
        Download Word
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onDownloadText}
        className="gap-2"
      >
        <FileText className="h-4 w-4" />
        Download Text
      </Button>
    </div>
  );
}

function EmptyIllustration() {
  return (
    <svg width="180" height="140" viewBox="0 0 180 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="22" y="14" width="92" height="116" rx="8" fill="var(--color-secondary)" stroke="var(--color-border)" strokeWidth="1.5" />
      <rect x="34" y="30" width="50" height="6" rx="3" fill="var(--color-border)" />
      <rect x="34" y="44" width="68" height="4" rx="2" fill="var(--color-border)" />
      <rect x="34" y="54" width="60" height="4" rx="2" fill="var(--color-border)" />
      <rect x="34" y="68" width="40" height="4" rx="2" fill="var(--color-border)" />
      <rect x="34" y="78" width="68" height="4" rx="2" fill="var(--color-border)" />
      <rect x="34" y="88" width="56" height="4" rx="2" fill="var(--color-border)" />
      <rect x="34" y="102" width="48" height="4" rx="2" fill="var(--color-border)" />

      <rect x="78" y="46" width="78" height="80" rx="8" fill="white" stroke="var(--color-primary)" strokeWidth="1.5" />
      <rect x="88" y="60" width="44" height="6" rx="3" fill="var(--color-primary)" opacity="0.8" />
      <rect x="88" y="74" width="58" height="4" rx="2" fill="var(--color-border)" />
      <rect x="88" y="84" width="50" height="4" rx="2" fill="var(--color-border)" />
      <rect x="88" y="94" width="54" height="4" rx="2" fill="var(--color-border)" />
      <rect x="88" y="104" width="40" height="4" rx="2" fill="var(--color-border)" />

      <circle cx="150" cy="34" r="14" fill="var(--color-primary)" />
      <path d="M144 34l5 5 9-10" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function sampleResume(role: string, _resume: string, _jd: string) {
  return `## JANE DOE
**${role}** | jane.doe@email.com | +1 (555) 123-4567 | linkedin.com/in/janedoe

## Professional Summary
Results-driven **${role}** with a track record of shipping high-impact products and driving measurable outcomes. Tailored for the target role with emphasis on the keywords and competencies highlighted in the job description.

## Core Skills
- Strategy & Roadmapping
- Cross-functional Leadership
- Data-Driven Decision Making
- Stakeholder Management
- Agile / Scrum
- Customer Research

## Experience

### Senior ${role} — Acme Corp (2022 – Present)
- Led initiatives that increased key metric by **38% YoY** by aligning teams around a focused roadmap.
- Partnered with engineering and design to deliver **12 major releases** on schedule.
- Built a measurement framework adopted across **4 product lines**.

### ${role} — Northwind Labs (2019 – 2022)
- Owned end-to-end delivery of a flagship feature used by **1.2M monthly users**.
- Reduced churn by **17%** via targeted onboarding experiments.

## Education
**B.S., Computer Science** — State University (2019)`;
}

function sampleLetter(role: string, _jd: string) {
  return `Dear Hiring Team,

I'm excited to apply for the **${role}** position. After reviewing the job description, I see a strong alignment between your needs and my background — particularly around strategic execution, cross-functional collaboration, and measurable customer impact.

In my current role, I've led initiatives that drove a **38% lift** in our north-star metric and shipped **12 major releases** through tight partnership with engineering and design. I thrive in environments where ambiguity is high and ownership is expected — which is exactly what stood out to me about this opportunity.

I'd love the chance to discuss how my experience can help your team accelerate its goals. Thank you for considering my application.

Best regards,  
Jane Doe`;
}
