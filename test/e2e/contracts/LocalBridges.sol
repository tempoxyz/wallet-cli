// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IToken {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice Local stand-in for Relay's v2 depository: holds ERC-20/TIP-20 deposits by order ID.
contract LocalDepository {
    event RelayErc20Deposit(address token, uint256 amount, address depositor, bytes32 id);

    function depositErc20(address depositor, address token, uint256 amount, bytes32 id) external {
        require(IToken(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit RelayErc20Deposit(token, amount, depositor, id);
    }
}

/// @notice Local stand-in for LZEndpointDollar: wraps a token 1:1 into the messaging-fee token.
contract LocalFeeWrapper {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function wrap(address token, address to, uint256 amount) external {
        require(IToken(token).transferFrom(msg.sender, address(this), amount), "transfer failed");
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Local stand-in for a Stargate OFT on Tempo: takes the token and the LZD fee, then emits
/// the send for an off-chain stand-in to deliver. Charges `feeBps` of the amount and `nativeFee`.
contract LocalStargate {
    struct SendParam {
        uint32 dstEid;
        bytes32 to;
        uint256 amountLD;
        uint256 minAmountLD;
        bytes extraOptions;
        bytes composeMsg;
        bytes oftCmd;
    }
    struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }
    struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }
    struct OFTFeeDetail { int256 feeAmountLD; string description; }
    struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }

    address public immutable token;
    address public immutable feeWrapper;
    uint256 public immutable feeBps;
    uint256 public immutable nativeFee;

    event Sent(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 amountReceivedLD);
    // What Stargate's OFT emits, which recovery searches when a send's hash was never recorded.
    event OFTSent(
        bytes32 indexed guid, uint32 dstEid, address indexed fromAddress, uint256 amountSentLD, uint256 amountReceivedLD
    );
    uint256 private sends;

    constructor(address token_, address feeWrapper_, uint256 feeBps_, uint256 nativeFee_) {
        token = token_; feeWrapper = feeWrapper_; feeBps = feeBps_; nativeFee = nativeFee_;
    }

    function received(uint256 amountLD) internal view returns (uint256) {
        return amountLD - (amountLD * feeBps) / 10_000;
    }

    function quoteOFT(SendParam calldata p)
        external view returns (OFTLimit memory, OFTFeeDetail[] memory, OFTReceipt memory)
    {
        OFTFeeDetail[] memory fees = new OFTFeeDetail[](1);
        fees[0] = OFTFeeDetail(-int256(p.amountLD - received(p.amountLD)), "protocol fee");
        return (OFTLimit(1, type(uint128).max), fees, OFTReceipt(p.amountLD, received(p.amountLD)));
    }

    function quoteSend(SendParam calldata, bool) external view returns (MessagingFee memory) {
        return MessagingFee(nativeFee, 0);
    }

    function sendToken(SendParam calldata p, MessagingFee calldata fee, address) external payable {
        require(fee.nativeFee >= nativeFee && fee.lzTokenFee == 0, "fee too low");
        require(LocalFeeWrapper(feeWrapper).transferFrom(msg.sender, address(this), fee.nativeFee), "fee failed");
        require(IToken(token).transferFrom(msg.sender, address(this), p.amountLD), "transfer failed");
        uint256 amount = received(p.amountLD);
        require(amount >= p.minAmountLD, "slippage");
        emit Sent(p.dstEid, p.to, p.amountLD, amount);
        emit OFTSent(keccak256(abi.encode(address(this), ++sends)), p.dstEid, msg.sender, p.amountLD, amount);
    }
}
