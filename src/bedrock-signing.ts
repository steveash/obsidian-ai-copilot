/** AWS Signature V4 signing for Bedrock runtime requests. */
export async function signBedrockRequest(
  method: string,
  url: URL,
  body: string,
  timestamp: string,
  region: string,
  accessKey: string,
  secretKey: string
): Promise<Record<string, string>> {
  const service = "bedrock";
  const dateStamp = timestamp.slice(0, 8);

  const enc = new TextEncoder();

  async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key instanceof ArrayBuffer ? new Uint8Array(key) as BufferSource : key as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  }

  async function sha256(data: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(data));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const payloadHash = await sha256(body);
  const host = url.hostname;
  const canonicalUri =
    "/" + url.pathname.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const canonicalQuerystring = "";

  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalHeaders =
    `content-type:application/json\nhost:${host}\nx-amz-date:${timestamp}\n`;

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    await sha256(canonicalRequest)
  ].join("\n");

  const kDate = await hmac(enc.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");

  const signatureBuffer = await hmac(kSigning, stringToSign);
  const signature = [...new Uint8Array(signatureBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "Content-Type": "application/json",
    "X-Amz-Date": timestamp,
    Authorization: authorization
  };
}
