# Third-party notices

## Runtime dependencies shipped to the browser

| Component                 | Version    | Licence    | Notes                                                                                     |
| ------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------- |
| React, React DOM          | 19.2.x     | MIT        |                                                                                           |
| @huggingface/transformers | 4.2.x      | Apache-2.0 | ML runtime                                                                                |
| onnxruntime-web           | 1.26.0-dev | MIT        | WebAssembly/WebGPU inference; vendored into `public/runtime/` by `tools/sync-runtime.mjs` |

`@huggingface/transformers` also depends on `sharp` and `onnxruntime-node` for its Node backend.
These are installed but never shipped to the browser; CI asserts their absence from the bundle.
npm `overrides` pin patched versions of `sharp` and `adm-zip` to keep `npm audit` clean.

## Models

Referenced by `models.json`. Weights are downloaded from Hugging Face on consent, or bundled where
noted; none are redistributed in this repository.

| Model                                                              | Licence    | Notes                           |
| ------------------------------------------------------------------ | ---------- | ------------------------------- |
| sentence-transformers/all-MiniLM-L6-v2 (`Xenova/all-MiniLM-L6-v2`) | Apache-2.0 | Bundled from M1                 |
| openai/whisper-tiny (`onnx-community/whisper-tiny`)                | MIT        | Bundled from M2                 |
| apple/MobileCLIP-S0 (`Xenova/mobileclip_s0`)                       | Apple ASCL | **Check before commercial use** |
| openai/clip-vit-base-patch32 (`Xenova/clip-vit-base-patch32`)      | MIT        | On demand, Tier A               |

## Sample data

The demo dataset (M1) will consist only of CC0, public-domain or self-made assets, credited in
`public/demo/manifest.json`.

## Not used

No Microsoft or Apple icons, wallpapers, fonts or other assets are used anywhere. The visual
design is original.
