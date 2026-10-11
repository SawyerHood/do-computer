# Third-party notices

Do Computer is MIT licensed (see `LICENSE`). This file names what in it, or shipped with it, was
written by someone else and comes with a notice that has to travel with it.

It does not list every npm dependency. Those are named in each `package.json` and pinned in
`pnpm-lock.yaml`, each under its own licence, which `pnpm licenses list` prints.

## Code copied into this repository

### Simplex noise (webgl-noise)

The 3D simplex noise in the creature's shaders, `NOISE` in `packages/mascot/src/orb-core.js`, is
`noise3Dgrad.glsl` from [webgl-noise](https://github.com/stegu/webgl-noise) by Ian McEwan,
Ashima Arts, and Stefan Gustavson, changed to return its slope and its value together. The
mock-ups under `prototypes/` that have the creature in them carry a copy of it in their
`index.html`.

```
Copyright (C) 2011 by Ashima Arts (Simplex noise)
Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### shadcn/ui

The components in `apps/web/src/components/ui` began as [shadcn/ui](https://ui.shadcn.com)
components and have been changed since. MIT License, Copyright (c) 2023 shadcn. The licence's
text is the one in `LICENSE`, under that copyright line.

## Fonts served by the web app

The web app is built with four fonts, taken from the [Fontsource](https://fontsource.org)
packages named below, and serves their files. Each is under the SIL Open Font License,
Version 1.1.

- **Jersey 25** (`@fontsource/jersey-25`): Copyright 2023 The Soft Type Project Authors
  (https://github.com/scfried/soft-type-jersey)
- **Inter** (`@fontsource-variable/inter`): Copyright 2016 The Inter Project Authors
  (https://github.com/rsms/inter)
- **Geist** and **Geist Mono** (`@fontsource-variable/geist`,
  `@fontsource-variable/geist-mono`): Copyright 2024 The Geist Project Authors
  (https://github.com/vercel/geist-font)

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Software inside the desktop app

The desktop app is packed with programs that are not part of this repository.

### Cua Driver

What uses the screen for agents is [Cua Driver](https://github.com/trycua/cua)
(`@trycua/cua-driver` and its package for each system), which is in the app's `Resources/driver`
folder as it was published. MIT License, Copyright (c) 2025 Cua AI, Inc.; the licence's text is
the one in `LICENSE`, under that copyright line.

Its Node runtime, `cua_driver_node_runtime.node`, is derived from the N-API runtime in
[uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native), and the
`@ubjs/core` and `@ubjs/node` packages beside it are that project's own. These are copyright
their contributors and under the Mozilla Public License 2.0
(https://www.mozilla.org/MPL/2.0/). Their source is in that repository, and the source and
build script of Cua's runtime are in the Cua repository at the release tag that matches the
package's version, which `apps/desktop/package.json` names.

### Electron and Chromium

The app runs on [Electron](https://www.electronjs.org) (MIT License, Copyright (c) Electron
contributors, Copyright (c) 2013-2020 GitHub Inc.), which includes Chromium and Node.js. Their
notices are the `LICENSE.electron.txt` and `LICENSES.chromium.html` files packed with the app.
