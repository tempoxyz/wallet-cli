---
wallet-cli: patch
---

`tempo request --mach` and `tempo wallet transfer --mach` now say when a service does not accept MACH, instead of a generic settlement failure. A service that offers no machine-enabled charge, or whose recipient the MACH swapper does not support (checked with the swapper's `merchantSupported`, or from a `MerchantNotSupported` revert when that read fails), returns `E_PAYMENT` "<host> doesn't accept MACH. Retry without --mach." before anything is signed. `transfer --mach` names the captured challenge's realm. This replaces "Server did not offer payment token MACH", "Server did not offer a machine-enabled MACH charge", and the "swap route could not be simulated" error for such services.
