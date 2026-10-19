#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Post-publish truth check for the delegated Registry flow. The release
// service currently ends successful publishes in RELEASE_CONFLICT
// (emdash-cms/emdash#4159): the intent writes the release record, then
// reconciliation judges that same record a conflict, failing the job.
// This verifier asks the publisher PDS directly whether the record for
// the selector version exists and carries exactly the bundle bytes
// this job prepared (same multihash checksum the Registry records).
// The publish step stays fail-closed: the job only passes when the
// Registry record matches, whatever the intent reported.
const RELEASE_COLLECTION = "com.emdashcms.experimental.package.release";
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function computePackageChecksum(bytes) {
	const digest = createHash("sha256").update(bytes).digest();
	const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of multihash) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return `b${out}`;
}

export function parseSelector(selector) {
	const at = selector?.lastIndexOf("@") ?? -1;
	if (at <= 0 || at === selector.length - 1) return null;
	return { slug: selector.slice(0, at), version: selector.slice(at + 1) };
}

export function recordMatches(value, expected) {
	const reasons = [];
	if (!value || typeof value !== "object") return { ok: false, reasons: ["record is not an object"] };
	if (value.package !== expected.slug) reasons.push(`package is ${JSON.stringify(value.package)}`);
	if (value.version !== expected.version) reasons.push(`version is ${JSON.stringify(value.version)}`);
	const artifact = value.artifacts?.package;
	if (!artifact || typeof artifact !== "object") {
		reasons.push("artifacts.package is missing");
	} else {
		if (artifact.checksum !== expected.checksum) reasons.push("package checksum differs");
		if (artifact.blob?.size !== expected.size) reasons.push("package blob size differs");
		if (artifact.blob?.mimeType !== "application/gzip") reasons.push("package blob is not gzip");
	}
	return { ok: reasons.length === 0, reasons };
}

export async function resolvePdsEndpoint(publisherDid, fetchImpl = fetch) {
	const url = publisherDid.startsWith("did:plc:")
		? `https://plc.directory/${publisherDid}`
		: publisherDid.startsWith("did:web:")
			? `https://${publisherDid.slice("did:web:".length).split(":").join("/")}/.well-known/did.json`
			: null;
	if (!url) throw new Error(`unsupported publisher DID method: ${publisherDid}`);
	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`DID resolution failed with HTTP ${response.status}`);
	const document = await response.json();
	const service = document?.service?.find((entry) =>
		entry?.id === "#atproto_pds" || entry?.id === `${publisherDid}#atproto_pds`,
	);
	if (!service?.serviceEndpoint) throw new Error("publisher DID has no #atproto_pds service");
	return service.serviceEndpoint;
}

async function fetchReleaseRecord(pds, publisherDid, slug, version, fetchImpl) {
	const url = new URL(`${pds.replace(/\/$/, "")}/xrpc/com.atproto.repo.getRecord`);
	url.searchParams.set("repo", publisherDid);
	url.searchParams.set("collection", RELEASE_COLLECTION);
	url.searchParams.set("rkey", `${slug}:${version}`);
	const response = await fetchImpl(url);
	if (response.status === 400) {
		const body = await response.json().catch(() => null);
		if (body?.error === "RecordNotFound") return null;
	}
	if (!response.ok) throw new Error(`getRecord failed with HTTP ${response.status}`);
	const record = await response.json();
	const expectedUri = `at://${publisherDid}/${RELEASE_COLLECTION}/${slug}:${version}`;
	if (record?.uri !== expectedUri) throw new Error("getRecord returned an unexpected record URI");
	return record;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [publisherDid, selector, bundleFile] = process.argv.slice(2);
	const parsed = parseSelector(selector);
	if (!publisherDid || !parsed || !bundleFile) {
		console.error("usage: verify-registry-release.mjs <publisher-did> <slug@version> <bundle-file>");
		process.exit(2);
	}
	const bytes = await readFile(bundleFile);
	const expected = {
		slug: parsed.slug,
		version: parsed.version,
		checksum: computePackageChecksum(bytes),
		size: bytes.byteLength,
	};
	const pds = await resolvePdsEndpoint(publisherDid);
	const deadline = Date.now() + 5 * 60_000;
	for (;;) {
		const record = await fetchReleaseRecord(pds, publisherDid, parsed.slug, parsed.version, fetch);
		if (record) {
			const result = recordMatches(record.value, expected);
			if (result.ok) {
				console.log(
					`registry_release_verified=${parsed.slug}@${parsed.version} uri=${record.uri} cid=${record.cid} checksum=${expected.checksum}`,
				);
				break;
			}
			console.error(
				`::error::Registry record for ${parsed.slug}@${parsed.version} does not match the prepared bundle: ${result.reasons.join("; ")}`,
			);
			process.exit(1);
		}
		if (Date.now() >= deadline) {
			console.error(
				`::error::Registry record for ${parsed.slug}@${parsed.version} did not appear within 5 minutes`,
			);
			process.exit(1);
		}
		await new Promise((resolve) => setTimeout(resolve, 15_000));
	}
}
