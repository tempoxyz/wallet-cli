import * as Assets from '../Assets.js';
import * as Chains from '../Chains.js';
import { charge as charge_ } from './Charge.js';
/** Creates EVM client methods from shared charge parameters. */
export function evm(parameters) {
    return [evm.charge(parameters)];
}
(function (evm) {
    /** Creates an EVM `charge` client method. */
    evm.charge = charge_;
    /** Known EVM asset metadata for public config. */
    evm.assets = Assets;
    /** Common EVM chain IDs for public config. */
    evm.chains = Chains;
})(evm || (evm = {}));
//# sourceMappingURL=Methods.js.map