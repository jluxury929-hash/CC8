/**
 * 🔱 APEX v38.9.20 - THE ALCHEMY WHALE TITAN (DYNAMIC)
 * Strategy: Mempool Whale-Tracking + Dynamic Flash Loans
 * Logic: Simulates via eth_call; executes ONLY if (Net Profit > Fees + Buffer)
 */

const { ethers, Wallet, WebSocketProvider } = require('ethers');

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    
    // --- WHALE & PROFIT FILTERS ---
    WHALE_THRESHOLD: ethers.parseEther("15"), // Trigger only for txs > 15 ETH
    MIN_NET_PROFIT: "0.012", // ~$40 take-home profit floor after gas/fees
    
    GAS_LIMIT: 980000n, // Dynamic loan logic requires higher gas overhead
    MAX_FEE: ethers.parseUnits("0.5", "gwei"),
    MAX_PRIORITY: ethers.parseUnits("0.4", "gwei"),
    WSS_URL: "wss://base-mainnet.g.alchemy.com/v2/G-WBAMA8JxJMjkc-BCeoK"
};

let provider, signer, nextNonce, heartbeatInterval;

async function startBot() {
    console.log(`\n🔱 APEX WHALE TITAN: ONLINE`);
    
    provider = new WebSocketProvider(CONFIG.WSS_URL);
    signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);

    try {
        nextNonce = await provider.getTransactionCount(signer.address, 'latest');
        console.log(`✅ CONNECTED | TREASURY: ${signer.address}`);
        console.log(`📡 MONITORING: Transactions > ${ethers.formatEther(CONFIG.WHALE_THRESHOLD)} ETH`);
    } catch (e) {
        return setTimeout(startBot, 5000);
    }

    // 🎯 REAL-TIME BLOCK SCANNER
    provider.on("block", async (num) => {
        const startTime = Date.now();
        try {
            const block = await provider.getBlock(num, true);
            process.stdout.write(`\r📦 BLOCK: ${num} | SCANNING FOR WHALES... `);

            // Filter for 'Whale' transactions
            const whaleMove = block.transactions.find(t => BigInt(t.value || 0) >= CONFIG.WHALE_THRESHOLD);

            if (whaleMove) {
                console.log(`\n🚨 WHALE DETECTED: ${ethers.formatEther(whaleMove.value)} ETH Move`);
                executeStrike(whaleMove.hash, startTime);
            }
        } catch (err) {}
    });

    // 💓 HEARTBEAT
    heartbeatInterval = setInterval(async () => {
        try { await provider.send("eth_blockNumber", []); } catch (e) {}
    }, 20000);
}

/**
 * CALCULATE LOAN SIZE BASED ON YOUR WALLET BALANCE
 */
async function getDynamicLoanAmount() {
    const balanceWei = await provider.getBalance(signer.address);
    const balanceEth = parseFloat(ethers.formatEther(balanceWei));
    const usdValue = balanceEth * 3300; // Estimated ETH Price

    if (usdValue >= 200) return ethers.parseEther("100"); // Pro
    if (usdValue >= 100) return ethers.parseEther("75");  // High
    if (usdValue >= 75)  return ethers.parseEther("50");  // Mid
    return ethers.parseEther("25"); // Base
}

async function executeStrike(targetHash, startTime) {
    try {
        const loanAmount = await getDynamicLoanAmount();
        const path = [CONFIG.WETH, CONFIG.USDC];

        // 1. ENCODE DYNAMIC DATA
        const iface = new ethers.Interface(["function requestTitanLoan(address,uint256,address[])"]);
        const strikeData = iface.encodeFunctionData("requestTitanLoan", [CONFIG.WETH, loanAmount, path]);

        // 2. SIMULATE PROFITABILITY
        const simulationResult = await provider.call({
            to: CONFIG.TARGET_CONTRACT,
            data: strikeData,
            from: signer.address
        });

        // 3. NET PROFIT CALCULATION
        const feeData = await provider.getFeeData();
        const gasCost = CONFIG.GAS_LIMIT * (feeData.maxFeePerGas || CONFIG.MAX_FEE);
        const aaveFee = (loanAmount * 5n) / 10000n; // 0.05% Aave Flash Fee
        
        const totalExpenses = gasCost + aaveFee;
        const rawProfit = BigInt(simulationResult);
        const netProfit = rawProfit - totalExpenses;

        // 4. THE STRIKE GUARD
        if (netProfit > ethers.parseEther(CONFIG.MIN_NET_PROFIT)) {
            console.log(`✅ PROFIT CONFIRMED: ${ethers.formatEther(netProfit)} ETH`);
            
            const tx = await signer.sendTransaction({
                to: CONFIG.TARGET_CONTRACT,
                data: strikeData,
                gasLimit: CONFIG.GAS_LIMIT,
                maxPriorityFeePerGas: CONFIG.MAX_PRIORITY,
                maxFeePerGas: CONFIG.MAX_FEE,
                nonce: nextNonce++,
                type: 2
            });
            
            console.log(`🚀 STRIKE FIRED: ${tx.hash.slice(0, 15)}... (${Date.now() - startTime}ms)`);
            await tx.wait();
        }
    } catch (e) {
        if (e.message.includes("nonce")) {
            nextNonce = await provider.getTransactionCount(signer.address, 'latest');
        }
    }
}

startBot();
