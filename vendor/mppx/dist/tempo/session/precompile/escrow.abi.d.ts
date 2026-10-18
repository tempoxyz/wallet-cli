/** ABI for the TIP-1034 TIP-20 Channel Escrow precompile. */
export declare const escrowAbi: readonly [{
    readonly type: 'function';
    readonly name: 'CLOSE_GRACE_PERIOD';
    readonly stateMutability: 'view';
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: 'uint64';
    }];
}, {
    readonly type: 'function';
    readonly name: 'VOUCHER_TYPEHASH';
    readonly stateMutability: 'view';
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: 'bytes32';
    }];
}, {
    readonly type: 'function';
    readonly name: 'open';
    readonly stateMutability: 'nonpayable';
    readonly inputs: readonly [{
        readonly name: 'payee';
        readonly type: 'address';
    }, {
        readonly name: 'operator';
        readonly type: 'address';
    }, {
        readonly name: 'token';
        readonly type: 'address';
    }, {
        readonly name: 'deposit';
        readonly type: 'uint96';
    }, {
        readonly name: 'salt';
        readonly type: 'bytes32';
    }, {
        readonly name: 'authorizedSigner';
        readonly type: 'address';
    }];
    readonly outputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
    }];
}, {
    readonly type: 'function';
    readonly name: 'settle';
    readonly stateMutability: 'nonpayable';
    readonly inputs: readonly [{
        readonly name: 'descriptor';
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'payer';
            readonly type: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
        }, {
            readonly name: 'operator';
            readonly type: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
        }, {
            readonly name: 'salt';
            readonly type: 'bytes32';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
        }, {
            readonly name: 'expiringNonceHash';
            readonly type: 'bytes32';
        }];
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint96';
    }, {
        readonly name: 'signature';
        readonly type: 'bytes';
    }];
    readonly outputs: readonly [];
}, {
    readonly type: 'function';
    readonly name: 'topUp';
    readonly stateMutability: 'nonpayable';
    readonly inputs: readonly [{
        readonly name: 'descriptor';
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'payer';
            readonly type: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
        }, {
            readonly name: 'operator';
            readonly type: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
        }, {
            readonly name: 'salt';
            readonly type: 'bytes32';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
        }, {
            readonly name: 'expiringNonceHash';
            readonly type: 'bytes32';
        }];
    }, {
        readonly name: 'additionalDeposit';
        readonly type: 'uint96';
    }];
    readonly outputs: readonly [];
}, {
    readonly type: 'function';
    readonly name: 'close';
    readonly stateMutability: 'nonpayable';
    readonly inputs: readonly [{
        readonly name: 'descriptor';
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'payer';
            readonly type: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
        }, {
            readonly name: 'operator';
            readonly type: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
        }, {
            readonly name: 'salt';
            readonly type: 'bytes32';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
        }, {
            readonly name: 'expiringNonceHash';
            readonly type: 'bytes32';
        }];
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint96';
    }, {
        readonly name: 'captureAmount';
        readonly type: 'uint96';
    }, {
        readonly name: 'signature';
        readonly type: 'bytes';
    }];
    readonly outputs: readonly [];
}, {
    readonly type: 'function';
    readonly name: 'requestClose';
    readonly stateMutability: 'nonpayable';
    readonly inputs: readonly [{
        readonly name: 'descriptor';
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'payer';
            readonly type: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
        }, {
            readonly name: 'operator';
            readonly type: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
        }, {
            readonly name: 'salt';
            readonly type: 'bytes32';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
        }, {
            readonly name: 'expiringNonceHash';
            readonly type: 'bytes32';
        }];
    }];
    readonly outputs: readonly [];
}, {
    readonly type: 'function';
    readonly name: 'withdraw';
    readonly stateMutability: 'nonpayable';
    readonly inputs: readonly [{
        readonly name: 'descriptor';
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'payer';
            readonly type: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
        }, {
            readonly name: 'operator';
            readonly type: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
        }, {
            readonly name: 'salt';
            readonly type: 'bytes32';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
        }, {
            readonly name: 'expiringNonceHash';
            readonly type: 'bytes32';
        }];
    }];
    readonly outputs: readonly [];
}, {
    readonly type: 'function';
    readonly name: 'getChannel';
    readonly stateMutability: 'view';
    readonly inputs: readonly [{
        readonly name: 'descriptor';
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'payer';
            readonly type: 'address';
        }, {
            readonly name: 'payee';
            readonly type: 'address';
        }, {
            readonly name: 'operator';
            readonly type: 'address';
        }, {
            readonly name: 'token';
            readonly type: 'address';
        }, {
            readonly name: 'salt';
            readonly type: 'bytes32';
        }, {
            readonly name: 'authorizedSigner';
            readonly type: 'address';
        }, {
            readonly name: 'expiringNonceHash';
            readonly type: 'bytes32';
        }];
    }];
    readonly outputs: readonly [{
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'descriptor';
            readonly type: 'tuple';
            readonly components: readonly [{
                readonly name: 'payer';
                readonly type: 'address';
            }, {
                readonly name: 'payee';
                readonly type: 'address';
            }, {
                readonly name: 'operator';
                readonly type: 'address';
            }, {
                readonly name: 'token';
                readonly type: 'address';
            }, {
                readonly name: 'salt';
                readonly type: 'bytes32';
            }, {
                readonly name: 'authorizedSigner';
                readonly type: 'address';
            }, {
                readonly name: 'expiringNonceHash';
                readonly type: 'bytes32';
            }];
        }, {
            readonly name: 'state';
            readonly type: 'tuple';
            readonly components: readonly [{
                readonly name: 'settled';
                readonly type: 'uint96';
            }, {
                readonly name: 'deposit';
                readonly type: 'uint96';
            }, {
                readonly name: 'closeRequestedAt';
                readonly type: 'uint32';
            }];
        }];
    }];
}, {
    readonly type: 'function';
    readonly name: 'getChannelState';
    readonly stateMutability: 'view';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
    }];
    readonly outputs: readonly [{
        readonly type: 'tuple';
        readonly components: readonly [{
            readonly name: 'settled';
            readonly type: 'uint96';
        }, {
            readonly name: 'deposit';
            readonly type: 'uint96';
        }, {
            readonly name: 'closeRequestedAt';
            readonly type: 'uint32';
        }];
    }];
}, {
    readonly type: 'function';
    readonly name: 'getChannelStatesBatch';
    readonly stateMutability: 'view';
    readonly inputs: readonly [{
        readonly name: 'channelIds';
        readonly type: 'bytes32[]';
    }];
    readonly outputs: readonly [{
        readonly type: 'tuple[]';
        readonly components: readonly [{
            readonly name: 'settled';
            readonly type: 'uint96';
        }, {
            readonly name: 'deposit';
            readonly type: 'uint96';
        }, {
            readonly name: 'closeRequestedAt';
            readonly type: 'uint32';
        }];
    }];
}, {
    readonly type: 'function';
    readonly name: 'computeChannelId';
    readonly stateMutability: 'view';
    readonly inputs: readonly [{
        readonly name: 'payer';
        readonly type: 'address';
    }, {
        readonly name: 'payee';
        readonly type: 'address';
    }, {
        readonly name: 'operator';
        readonly type: 'address';
    }, {
        readonly name: 'token';
        readonly type: 'address';
    }, {
        readonly name: 'salt';
        readonly type: 'bytes32';
    }, {
        readonly name: 'authorizedSigner';
        readonly type: 'address';
    }, {
        readonly name: 'expiringNonceHash';
        readonly type: 'bytes32';
    }];
    readonly outputs: readonly [{
        readonly type: 'bytes32';
    }];
}, {
    readonly type: 'function';
    readonly name: 'getVoucherDigest';
    readonly stateMutability: 'view';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint96';
    }];
    readonly outputs: readonly [{
        readonly type: 'bytes32';
    }];
}, {
    readonly type: 'function';
    readonly name: 'domainSeparator';
    readonly stateMutability: 'view';
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: 'bytes32';
    }];
}, {
    readonly type: 'event';
    readonly name: 'ChannelOpened';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'operator';
        readonly type: 'address';
    }, {
        readonly name: 'token';
        readonly type: 'address';
    }, {
        readonly name: 'authorizedSigner';
        readonly type: 'address';
    }, {
        readonly name: 'salt';
        readonly type: 'bytes32';
    }, {
        readonly name: 'expiringNonceHash';
        readonly type: 'bytes32';
    }, {
        readonly name: 'deposit';
        readonly type: 'uint96';
    }];
}, {
    readonly type: 'event';
    readonly name: 'Settled';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint96';
    }, {
        readonly name: 'deltaPaid';
        readonly type: 'uint96';
    }, {
        readonly name: 'newSettled';
        readonly type: 'uint96';
    }];
}, {
    readonly type: 'event';
    readonly name: 'TopUp';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'additionalDeposit';
        readonly type: 'uint96';
    }, {
        readonly name: 'newDeposit';
        readonly type: 'uint96';
    }];
}, {
    readonly type: 'event';
    readonly name: 'CloseRequested';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'closeGraceEnd';
        readonly type: 'uint256';
    }];
}, {
    readonly type: 'event';
    readonly name: 'ChannelClosed';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'settledToPayee';
        readonly type: 'uint96';
    }, {
        readonly name: 'refundedToPayer';
        readonly type: 'uint96';
    }];
}, {
    readonly type: 'event';
    readonly name: 'CloseRequestCancelled';
    readonly inputs: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
        readonly indexed: true;
    }, {
        readonly name: 'payer';
        readonly type: 'address';
        readonly indexed: true;
    }, {
        readonly name: 'payee';
        readonly type: 'address';
        readonly indexed: true;
    }];
}];
//# sourceMappingURL=escrow.abi.d.ts.map