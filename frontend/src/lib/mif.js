import { NVImage } from "@niivue/niivue";

// MRtrix .mif / .mif.gz images (inbox 6 Nov: "mif support"). The viewer can
// read them, but the analyses can't (nibabel has no MIF reader), so a .mif is
// turned into a NIfTI the moment it is opened: NiiVue reads it and writes the
// same voxels, data type and position as NIfTI-1. From then on it is an
// ordinary .nii layer (or base) everywhere: classification, analyses,
// downloads and workspaces. Uncompressed .nii, so no compression step.
export const MIF_RE = /\.mif(\.gz)?$/i;

export const isMifName = (name) => MIF_RE.test(String(name || ""));

export const niftiNameForMif = (name) => String(name).replace(MIF_RE, ".nii");

/** NIfTI bytes for a .mif / .mif.gz image's bytes. */
export async function mifBytesToNifti(bytes, name) {
  const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const img = await NVImage.new(buf, name);
  return img.saveToUint8Array(niftiNameForMif(name));
}

/** The File itself, or its NIfTI copy when it is a .mif. */
export async function niftiFileFor(file) {
  if (!file || !isMifName(file.name)) return file;
  const out = await mifBytesToNifti(await file.arrayBuffer(), file.name);
  return new File([out], niftiNameForMif(file.name), { type: "application/octet-stream" });
}

/** A main-process read result ({ ok, bytes, name, … }), with a .mif's bytes and name replaced by NIfTI. */
export async function niftiReadResult(res) {
  if (!res?.ok || !isMifName(res.name)) return res;
  return { ...res, bytes: await mifBytesToNifti(res.bytes, res.name), name: niftiNameForMif(res.name) };
}
