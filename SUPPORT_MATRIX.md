# Support matrix

All rows are **untested / unsupported**. API detection, desktop QA and synthetic replay do not
promote rows. Exact OS/browser builds must come from the physical run, not the research brief.

| ID  | Required physical target                          | Experiment                             | Status   | Evidence                 |
| --- | ------------------------------------------------- | -------------------------------------- | -------- | ------------------------ |
| A1  | 2019-class ARCore Android, ideally Xiaomi Mi 9 SE | WebXR, capture                         | untested | none                     |
| A2  | 2021–2023 mid-range Android                       | WebXR                                  | untested | none                     |
| A3  | 2024+ Android, Chrome and Samsung Internet        | WebXR                                  | untested | none                     |
| A4  | Non-WebXR Android                                 | capture, patch                         | untested | none                     |
| A5  | Android in-app WebView                            | capability/permission paths            | untested | none                     |
| I1  | iPhone 11/12                                      | Safari capture, patch                  | untested | none                     |
| I2  | iPhone 14/15                                      | Safari and iOS Chrome capture, patch   | untested | none                     |
| I3  | iPhone 16/17                                      | current and beta Safari capture, patch | untested | none                     |
| I4  | iPhone in-app browser                             | capability/permission paths            | untested | none                     |
| D1  | Desktop Chrome/Firefox/Safari                     | detection; future non-AR viewer        | untested | no support qualification |

Experimental promotion requires two independent physical runs on different days with exact
builds and commit. Supported promotion additionally requires all scenarios, target metrics (or
explicit justified exceptions), no open P0/P1 and documented limitations. See
[validation](docs/validation.md). No shipped backend currently has a support tier.
