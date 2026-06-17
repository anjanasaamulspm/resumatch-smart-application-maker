import { createServerFn } from "@tanstack/react-start";

const CLIENT_USER = "resumatch-client-user";

function getCreds() {
  const baseUrl = process.env.DIFY_API_URL;
  const apiKey = process.env.DIFY_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("Missing DIFY_API_URL or DIFY_API_KEY platform secret");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

export const uploadResumeToDify = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { fileBase64: string; fileName: string; mimeType: string }) => input,
  )
  .handler(async ({ data }) => {
    const { baseUrl, apiKey } = getCreds();
    const bytes = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: data.mimeType || "application/octet-stream" });

    const fd = new FormData();
    fd.append("file", blob, data.fileName);
    fd.append("user", CLIENT_USER);

    const res = await fetch(`${baseUrl}/files/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    if (!res.ok) {
      throw new Error(
        `File upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as { id?: string };
    if (!json?.id) throw new Error("Upload response missing id");
    return { id: json.id };
  });

export const runDifyWorkflow = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { uploadFileId: string; targetRole: string; jobDescription: string }) => input,
  )
  .handler(async ({ data }) => {
    const { baseUrl, apiKey } = getCreds();
    const res = await fetch(`${baseUrl}/workflows/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {
          Target_Role: data.targetRole,
          Job_Description: data.jobDescription,
          Current_Resume: {
            transfer_method: "local_file",
            type: "document",
            upload_file_id: data.uploadFileId,
          },
        },
        response_mode: "blocking",
        user: CLIENT_USER,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Workflow failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as any;
    const outputs = json?.data?.outputs ?? {};
    return {
      tailoredResume: (outputs.LLM3_textString as string) ?? "",
      coverLetter: (outputs.LLM2_textString as string) ?? "",
    };
  });
