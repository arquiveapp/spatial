# Third-party notices and distribution boundaries

Original Spatial code is MIT; see LICENSE. The npm artifacts currently contain original JS and
its internal core dependency only. There are no external runtime engines, model assets or decoder
binaries. Existing development tools are not bundled in the npm library.

`tools/sbom/reviewed.json` records exact lockfile versions, integrity, source and hashes of reviewed
licence/notice files. `npm run check:rights` rejects absent/stale review, unknown/prohibited licence
identifiers, new lifecycle scripts and any newly introduced external runtime/compiled dependency.
This is a fail-closed inventory gate for the present distribution, not blanket legal clearance.

- TypeScript 7.0.2: Apache-2.0, https://github.com/microsoft/TypeScript; build only. Preserve its
  LICENSE and NOTICE.txt in tooling. Non-host optional platform packages are pinned by integrity
  and use the TypeScript package's family licence/notice as evidence; their binaries were not
  installed or audited on this host. Native compiler notices also remain in the installed package.
- Prettier 3.9.6: MIT, https://github.com/prettier/prettier; build only. Its bundled dependencies
  declare MIT, ISC, BSD-2/3, Apache-2.0 and BlueOak-1.0.0 in THIRD-PARTY-NOTICES.md. That full file
  is hash-checked. These are existing development-only components, never shipped browser code.
- publint 0.3.24 and @publint/pack 0.1.7: MIT, https://github.com/publint/publint; build only.
- mri 1.2.0 and sade 1.8.1: MIT, https://github.com/lukeed/mri and https://github.com/lukeed/sade.
- package-manager-detector 1.8.0: MIT, https://github.com/antfu-collective/package-manager-detector.
- picocolors 1.1.1: ISC, https://github.com/alexeyraspopov/picocolors.
- tinyexec 1.3.1: MIT, https://github.com/tinylibs/tinyexec. All above are development-only.
- Emscripten 6.0.2: MIT OR NCSA, https://github.com/emscripten-core/emscripten/tree/6.0.2;
  digest/platform pinned in docker/emsdk/toolchain.json. Local diagnostic builds only; no JS glue
  or WASM is included in npm. The compiler includes LLVM/runtime components under their own
  licences, not Spatial's MIT. When hosting generated lab artifacts preserve the generated
  toolchain licence texts alongside them. No toolchain binary is committed.

three.js 0.185.1 is an exact MIT development dependency used only by the authorized local lab,
including its original GLTFLoader/OrbitControls/utilities. Its installed LICENSE is hash-checked
and available at `/vendor/three/LICENSE` to authenticated lab clients. None of it enters npm
library tarballs. cloudflared 2026.8.3 is an existing optional local CLI, not bundled or installed
by the library.

OpenCV/Eigen/Sophus/wasm-feature-detect remain proposals, not dependencies. Adopting any
requires exact-source and compiled/transitive review plus an update to this gate and notices.
Eigen requires MPL source availability, `EIGEN_MPL2_ONLY` and build enforcement against LGPL files.
No GPL/LGPL/AGPL/NC/proprietary component is allowed in the default browser distribution.
