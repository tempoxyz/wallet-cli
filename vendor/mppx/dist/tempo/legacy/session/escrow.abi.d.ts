/** ABI for the legacy contract-backed Tempo stream channel escrow. */
export declare const escrowAbi: readonly [{
    readonly type: 'function';
    readonly name: 'CLOSE_GRACE_PERIOD';
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: '';
        readonly type: 'uint64';
        readonly internalType: 'uint64';
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'VOUCHER_TYPEHASH';
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: '';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'channels';
    readonly inputs: readonly [{
        readonly name: '';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly outputs: readonly [{
        readonly name: 'finalized';
        readonly type: 'bool';
        readonly internalType: 'bool';
    }, {
        readonly name: 'closeRequestedAt';
        readonly type: 'uint64';
        readonly internalType: 'uint64';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'token';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'authorizedSigner';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'deposit';
        readonly type: 'uint128';
        readonly internalType: 'uint128';
    }, {
        readonly name: 'settled';
        readonly type: 'uint128';
        readonly internalType: 'uint128';
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'close';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint128';
        readonly internalType: 'uint128';
    }, {
        readonly name: 'signature';
        readonly type: 'bytes';
        readonly internalType: 'bytes';
    }];
    readonly outputs: readonly [];
    readonly stateMutability: 'nonpayable';
}, {
    readonly type: 'function';
    readonly name: 'computeChannelId';
    readonly inputs: readonly [{
        readonly name: 'payer';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'token';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'salt';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'authorizedSigner';
        readonly type: 'address';
        readonly internalType: 'address';
    }];
    readonly outputs: readonly [{
        readonly name: '';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'domainSeparator';
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: '';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'eip712Domain';
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: 'fields';
        readonly type: 'bytes1';
        readonly internalType: 'bytes1';
    }, {
        readonly name: 'name';
        readonly type: 'string';
        readonly internalType: 'string';
    }, {
        readonly name: 'version';
        readonly type: 'string';
        readonly internalType: 'string';
    }, {
        readonly name: 'chainId';
        readonly type: 'uint256';
        readonly internalType: 'uint256';
    }, {
        readonly name: 'verifyingContract';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'salt';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'extensions';
        readonly type: 'uint256[]';
        readonly internalType: 'uint256[]';
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'getChannel';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly outputs: readonly [{
        readonly name: '';
        readonly type: 'tuple';
        readonly internalType: 'struct TempoStreamChannel.Channel';
        readonly components: readonly [{
            readonly name: 'finalized';
            readonly type: 'bool';
            readonly internalType: 'bool';
        }, {
            readonly name: 'closeRequestedAt';
            readonly type: 'uint64';
            readonly internalType: 'uint64';
        }, {
            readonly name: 'payer';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'deposit';
            readonly type: 'uint128';
            readonly internalType: 'uint128';
        }, {
            readonly name: 'settled';
            readonly type: 'uint128';
            readonly internalType: 'uint128';
        }];
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'getChannelsBatch';
    readonly inputs: readonly [{
        readonly name: 'channelIds';
        readonly type: 'bytes32[]';
        readonly internalType: 'bytes32[]';
    }];
    readonly outputs: readonly [{
        readonly name: 'channelStates';
        readonly type: 'tuple[]';
        readonly internalType: 'struct TempoStreamChannel.Channel[]';
        readonly components: readonly [{
            readonly name: 'finalized';
            readonly type: 'bool';
            readonly internalType: 'bool';
        }, {
            readonly name: 'closeRequestedAt';
            readonly type: 'uint64';
            readonly internalType: 'uint64';
        }, {
            readonly name: 'payer';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
            readonly internalType: 'address';
        }, {
            readonly name: 'deposit';
            readonly type: 'uint128';
            readonly internalType: 'uint128';
        }, {
            readonly name: 'settled';
            readonly type: 'uint128';
            readonly internalType: 'uint128';
        }];
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'getVoucherDigest';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint128';
        readonly internalType: 'uint128';
    }];
    readonly outputs: readonly [{
        readonly name: '';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly stateMutability: 'view';
}, {
    readonly type: 'function';
    readonly name: 'open';
    readonly inputs: readonly [{
        readonly name: 'payee';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'token';
        readonly type: 'address';
        readonly internalType: 'address';
    }, {
        readonly name: 'deposit';
        readonly type: 'uint128';
        readonly internalType: 'uint128';
    }, {
        readonly name: 'salt';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'authorizedSigner';
        readonly type: 'address';
        readonly internalType: 'address';
    }];
    readonly outputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly stateMutability: 'nonpayable';
}, {
    readonly type: 'function';
    readonly name: 'requestClose';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly outputs: readonly [];
    readonly stateMutability: 'nonpayable';
}, {
    readonly type: 'function';
    readonly name: 'settle';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint128';
        readonly internalType: 'uint128';
    }, {
        readonly name: 'signature';
        readonly type: 'bytes';
        readonly internalType: 'bytes';
    }];
    readonly outputs: readonly [];
    readonly stateMutability: 'nonpayable';
}, {
    readonly type: 'function';
    readonly name: 'topUp';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'additionalDeposit';
        readonly type: 'uint256';
        readonly internalType: 'uint256';
    }];
    readonly outputs: readonly [];
    readonly stateMutability: 'nonpayable';
}, {
    readonly type: 'function';
    readonly name: 'withdraw';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly internalType: 'bytes32';
    }];
    readonly outputs: readonly [];
    readonly stateMutability: 'nonpayable';
}, {
    readonly type: 'event';
    readonly name: 'ChannelClosed';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'settledToPayee';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }, {
        readonly name: 'refundedToPayer';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }];
    readonly anonymous: false;
}, {
    readonly type: 'event';
    readonly name: 'ChannelExpired';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }];
    readonly anonymous: false;
}, {
    readonly type: 'event';
    readonly name: 'ChannelOpened';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'token';
        readonly type: 'address';
        readonly indexed: false;
        readonly internalType: 'address';
    }, {
        readonly name: 'authorizedSigner';
        readonly type: 'address';
        readonly indexed: false;
        readonly internalType: 'address';
    }, {
        readonly name: 'salt';
        readonly type: 'bytes32';
        readonly indexed: false;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'deposit';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }];
    readonly anonymous: false;
}, {
    readonly type: 'event';
    readonly name: 'CloseRequestCancelled';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }];
    readonly anonymous: false;
}, {
    readonly type: 'event';
    readonly name: 'CloseRequested';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'closeGraceEnd';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }];
    readonly anonymous: false;
}, {
    readonly type: 'event';
    readonly name: 'Settled';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }, {
        readonly name: 'deltaPaid';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }, {
        readonly name: 'newSettled';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }];
    readonly anonymous: false;
}, {
    readonly type: 'event';
    readonly name: 'TopUp';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
        readonly internalType: 'bytes32';
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
        readonly internalType: 'address';
    }, {
        readonly name: 'additionalDeposit';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }, {
        readonly name: 'newDeposit';
        readonly type: 'uint256';
        readonly indexed: false;
        readonly internalType: 'uint256';
    }];
    readonly anonymous: false;
}, {
    readonly type: 'error';
    readonly name: 'AmountExceedsDeposit';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'AmountNotIncreasing';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'ChannelAlreadyExists';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'ChannelFinalized';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'ChannelNotFound';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'CloseNotReady';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'DepositOverflow';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'InvalidPayee';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'InvalidSignature';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'NotPayee';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'NotPayer';
    readonly inputs: readonly [];
}, {
    readonly type: 'error';
    readonly name: 'TransferFailed';
    readonly inputs: readonly [];
}];
//# sourceMappingURL=escrow.abi.d.ts.map