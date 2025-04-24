// Import dependencies
const { ethers } = require("ethers");
const inquirer = require("inquirer");
const chalk = require("chalk");
const figlet = require("figlet");

// Configuration
const USE_ALL_TOKEN_BALANCE = true;
const RPC_URL = "https://carrot.megaeth.com/rpc";
const ROUTER_ADDRESS = ethers.getAddress("0xa6b579684e943f7d00d616a48cf99b5147fc57a5");
const DELAY_SWAP = 2;
const DELAY_ERROR = 5;
const MAX_RETRY = 3;
const SLIPPAGE = 0.01;
const GAS_LIMIT = 600000; // Increased gas limit
const GAS_PRICE_MULTIPLIER = 1.3; // Increased gas price multiplier
const BASE_TOKEN = "ETH";
const MIN_NATIVE_BALANCE = 0.001; // Increased minimum balance to keep
const SWAP_PERCENTAGE = 0.3;

// Corrected checksummed addresses
const GTE_TOKENS = {
  MegaETH: { address: ethers.getAddress("0x10a6be7d23989d00d528e68cf8051d095f741145"), decimals: 18 },
  WETH: { address: ethers.getAddress("0x776401b9bc8aae31a685731b7147d4445fd9fb19"), decimals: 18 },
  GTE: { address: ethers.getAddress("0x9629684df53db9e4484697d0a50c442b2bfa80a8"), decimals: 18 },
  USDC: { address: ethers.getAddress("0x8d635c4702ba38b1f1735e8e784c7265dcc0b623"), decimals: 6 },
  tkUSDC: { address: ethers.getAddress("0xfaf334e157175ff676911adcf0964d7f54f2c424"), decimals: 6 },
  Kimchizuki: { address: ethers.getAddress("0xa626f15d10f2b30af1fb0d017f20a579500b5029"), decimals: 18 },
  five: { address: ethers.getAddress("0xf512886bc6877b0740e8ca0b3c12bb4ca602b530"), decimals: 18 },
  "gte pepe": { address: ethers.getAddress("0xbba08cf5ece0cc21e1deb5168746c001b123a756"), decimals: 18 },
  Enzo: { address: ethers.getAddress("0x9cd3a7b840464d83bee643bc9064d246375b07a3"), decimals: 18 },
  Nazdaq: { address: ethers.getAddress("0xd0ed4c2af51bb08c58a808b9b407508261a87f25"), decimals: 18 },
  Toast: { address: ethers.getAddress("0xc49ae2a62e7c18b7ddcab67617a63bf5182b08de"), decimals: 18 },
  ETH: { address: null, decimals: 18 },
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
];

// Utility Functions
const printHeader = () => {
  console.log(chalk.cyan(figlet.textSync("MegaETH-GTE", { horizontalLayout: "full" })));
  console.log(chalk.cyan("???????????????????????????????????????????????????????????????????????"));
  console.log(chalk.cyan("AUTO SWAP - 0xzer0toher0"));
  console.log(chalk.cyan("Join Telegram: @ngadukbang"));
  console.log(chalk.cyan("???????????????????????????????????????????????????????????????????????"));
};

const showBalances = async (provider, wallet) => {
  console.log(chalk.blue("\n?? Wallet Balances:"));
  console.log(chalk.blue("???????????????????????"));
  for (const token in GTE_TOKENS) {
    try {
      let balance;
      if (token === "ETH") {
        balance = await provider.getBalance(wallet.address);
      } else {
        const contract = new ethers.Contract(GTE_TOKENS[token].address, ERC20_ABI, wallet);
        balance = await contract.balanceOf(wallet.address);
      }
      
      // Convert the BigInt balance to a string first
      const balanceString = balance.toString();
      // Then format it properly with ethers
      const formattedBalance = ethers.formatUnits(balanceString, GTE_TOKENS[token].decimals);
      // Round to a maximum of 6 decimal places
      const roundedBalance = parseFloat(formattedBalance).toFixed(6);
      
      console.log(chalk.blue(`${token.padEnd(10)}: ${roundedBalance}`));
    } catch (error) {
      console.log(chalk.red(`[!] Error getting balance for ${token}: ${error.message}`));
      console.log(chalk.blue(`${token.padEnd(10)}: 0.000000`));
    }
  }
  console.log(chalk.blue("???????????????????????"));
};

// Check if token has enough allowance, if not approve
const ensureAllowance = async (wallet, tokenAddress, amount) => {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const currentAllowance = await tokenContract.allowance(wallet.address, ROUTER_ADDRESS);
    
    if (currentAllowance < amount) {
      console.log(chalk.yellow(`[!] Approving token for trading...`));
      // Approve a very large amount to avoid future approvals
      const largeApproval = ethers.parseUnits("1000000000", await tokenContract.decimals());
      const feeData = await wallet.provider.getFeeData();
      const gasPrice = BigInt(Math.round(Number(feeData.gasPrice) * GAS_PRICE_MULTIPLIER));
      
      const tx = await tokenContract.approve(ROUTER_ADDRESS, largeApproval, {
        gasLimit: 100000,
        gasPrice,
      });
      
      console.log(chalk.yellow(`[!] Approval transaction sent: ${tx.hash}`));
      const receipt = await tx.wait();
      console.log(chalk.green(`[?] Approval successful!`));
      return true;
    }
    return true;
  } catch (error) {
    console.log(chalk.red(`[!] Approval error: ${error.message}`));
    return false;
  }
};

// Get quote for the swap to show expected output
const getSwapQuote = async (router, tokenIn, tokenOut, amountIn) => {
  try {
    let path;
    if (tokenIn === BASE_TOKEN) {
      path = [GTE_TOKENS["WETH"].address, GTE_TOKENS[tokenOut].address];
    } else if (tokenOut === BASE_TOKEN) {
      path = [GTE_TOKENS[tokenIn].address, GTE_TOKENS["WETH"].address];
    } else {
      path = [GTE_TOKENS[tokenIn].address, GTE_TOKENS["WETH"].address, GTE_TOKENS[tokenOut].address];
    }
    
    const amounts = await router.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (error) {
    console.log(chalk.yellow(`[!] Could not get quote: ${error.message}`));
    return BigInt(0);
  }
};

// New function to check if the amount is worth swapping
const isAmountWorthSwapping = (amountDecimal, tokenIn) => {
  // Set minimum amounts that make sense to swap based on token
  const minimumAmounts = {
    ETH: 0.0005,      // Minimum ETH
    default: 1.0      // Default minimum for other tokens
  };
  
  const minAmount = minimumAmounts[tokenIn] || minimumAmounts.default;
  
  if (amountDecimal < minAmount) {
    console.log(chalk.yellow(`[!] Amount too small to swap: ${amountDecimal} ${tokenIn} (minimum ${minAmount})`));
    return false;
  }
  return true;
};

const swap = async (provider, wallet, router, tokenIn, tokenOut, amountDecimal) => {
  const tokenInData = GTE_TOKENS[tokenIn];
  const tokenOutData = GTE_TOKENS[tokenOut];
  const deadline = Math.floor(Date.now() / 1000) + 1800;
  
  // Safety check for amount
  if (isNaN(amountDecimal) || amountDecimal <= 0) {
    console.log(chalk.yellow(`[!] Skipping swap from ${tokenIn} to ${tokenOut}: Invalid amount ${amountDecimal}`));
    return null;
  }
  
  // Check if the amount is worth swapping
  if (!isAmountWorthSwapping(amountDecimal, tokenIn)) {
    return null;
  }
  
  // Format amount properly to avoid underflow errors
  // Convert to string with limited decimal places to avoid floating point issues
  let amountString;
  if (tokenIn === "ETH") {
    // For ETH use more precise rounding to handle gas costs
    amountString = amountDecimal.toFixed(18);
  } else {
    amountString = amountDecimal.toFixed(tokenInData.decimals > 8 ? 8 : tokenInData.decimals);
  }
  
  const amountIn = ethers.parseUnits(amountString, tokenInData.decimals);
  const amountOutMin = 0; // No minimum output for simplicity
  
  let maxRetries = MAX_RETRY;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      let nonce = await provider.getTransactionCount(wallet.address, "pending");
      const feeData = await provider.getFeeData();
      const gasPrice = BigInt(Math.round(Number(feeData.gasPrice) * GAS_PRICE_MULTIPLIER));
      
      console.log(chalk.yellow(`[?] Preparing SWAP: ${tokenIn} ? ${tokenOut} = ${amountDecimal.toFixed(6)} ${tokenIn}`));
      
      let tx;
      
      if (tokenIn === BASE_TOKEN) {
        // ETH to token swap
        const path = [GTE_TOKENS["WETH"].address, tokenOutData.address];
        
        // Make sure we don't attempt to spend all our ETH (leave some for gas)
        const ethBalance = await provider.getBalance(wallet.address);
        const safeAmountIn = ethBalance - BigInt(Math.round(GAS_LIMIT * Number(gasPrice) * 1.5));
        
        if (amountIn > safeAmountIn) {
          console.log(chalk.yellow(`[!] Reducing swap amount to ensure enough ETH for gas`));
          // Use 80% of safe amount
          const reducedAmount = BigInt(Math.floor(Number(safeAmountIn) * 0.8));
          if (reducedAmount <= 0) {
            console.log(chalk.red(`[!] Not enough ETH for swap and gas. Skipping.`));
            return null;
          }
        }
        
        tx = await router.swapExactETHForTokens(
          amountOutMin,
          path,
          wallet.address,
          deadline,
          {
            value: amountIn,
            gasLimit: GAS_LIMIT,
            gasPrice,
            nonce,
          }
        );
      } else if (tokenOut === BASE_TOKEN) {
        // Token to ETH swap
        const approved = await ensureAllowance(wallet, tokenInData.address, amountIn);
        if (!approved) {
          console.log(chalk.red(`[!] Failed to approve token. Skipping swap.`));
          return null;
        }
        
        const path = [tokenInData.address, GTE_TOKENS["WETH"].address];
        tx = await router.swapExactTokensForETH(
          amountIn,
          amountOutMin,
          path,
          wallet.address,
          deadline,
          {
            gasLimit: GAS_LIMIT,
            gasPrice,
            nonce,
          }
        );
      } else {
        // Token to token swap
        const approved = await ensureAllowance(wallet, tokenInData.address, amountIn);
        if (!approved) {
          console.log(chalk.red(`[!] Failed to approve token. Skipping swap.`));
          return null;
        }
        
        const path = [tokenInData.address, GTE_TOKENS["WETH"].address, tokenOutData.address];
        tx = await router.swapExactTokensForTokens(
          amountIn,
          amountOutMin,
          path,
          wallet.address,
          deadline,
          {
            gasLimit: GAS_LIMIT,
            gasPrice,
            nonce,
          }
        );
      }

      console.log(chalk.yellow(`[?] Transaction sent: ${tx.hash}`));
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log(chalk.green(`[?] SWAP ${tokenIn} ? ${tokenOut} = ${amountDecimal.toFixed(6)} ${tokenIn} SUCCESS!`));
      } else {
        console.log(chalk.red(`[!] Swap transaction failed but didn't throw an error`));
        throw new Error("Transaction failed");
      }
      
      return receipt;
    } catch (e) {
      retryCount++;
      console.log(chalk.red(`[!] Error: ${e.message}`));
      
      if (retryCount < maxRetries) {
        console.log(chalk.yellow(`[!] Retrying transaction (${retryCount}/${maxRetries})...`));
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      } else {
        console.log(chalk.red(`[!] Failed after ${maxRetries} attempts.`));
        throw e;
      }
    }
  }

  throw new Error("Failed to swap after multiple attempts. Please try again later.");
};

// UI and Main Logic
const provider = new ethers.JsonRpcProvider(RPC_URL);
let wallet = null;
let router = null;

const getPrivateKey = async () => {
  const { privateKey } = await inquirer.prompt([
    {
      type: "input",
      name: "privateKey",
      message: chalk.cyan("?? Enter your Private Key (without '0x'):"),
      default: "your private key", // Hardcoded for example
      validate: (input) => {
        if (!input || input.length < 64) return "Private key must be 64 characters long.";
        return true;
      },
    },
  ]);
  try {
    // Add '0x' prefix if not provided
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    wallet = new ethers.Wallet(formattedKey, provider);
    router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
    console.log(chalk.cyan(`?? Wallet Address: ${wallet.address}`));
  } catch (error) {
    console.log(chalk.red(`[!] Error initializing wallet: ${error.message}`));
    process.exit(1);
  }
};

const getTokenBalance = async (token) => {
  try {
    let balance;
    if (token === "ETH") {
      balance = await provider.getBalance(wallet.address);
    } else {
      const contract = new ethers.Contract(GTE_TOKENS[token].address, ERC20_ABI, wallet);
      balance = await contract.balanceOf(wallet.address);
    }
    
    // Convert BigInt to string first to avoid precision issues
    const balanceString = balance.toString();
    // Format the balance with proper decimal handling
    const formattedBalance = ethers.formatUnits(balanceString, GTE_TOKENS[token].decimals);
    // Parse as float with precision control
    return parseFloat(parseFloat(formattedBalance).toFixed(6));
  } catch (error) {
    console.log(chalk.red(`[!] Error getting balance for ${token}: ${error.message}`));
    return 0; // Fallback to 0 in case of error
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const swapMenu = async () => {
  const { rounds, percent } = await inquirer.prompt([
    {
      type: "number",
      name: "rounds",
      message: chalk.cyan("?? How many swap rounds?"),
      validate: (input) => (input > 0 ? true : "Number of rounds must be greater than 0."),
    },
    {
      type: "number",
      name: "percent",
      message: chalk.cyan("?? What percentage of balance to swap each time (e.g., 30)?"),
      validate: (input) =>
        input > 0 && input <= 100 ? true : "Percentage must be between 0 and 100.",
    },
  ]);

  const swapFraction = percent / 100;
  const tokens = Object.keys(GTE_TOKENS).filter((k) => k !== BASE_TOKEN);

  for (let i = 0; i < rounds; i++) {
    console.log(chalk.cyan(`\n?? Swap Round ${i + 1}`));
    await showBalances(provider, wallet);

    // ETH to tokens - only swap if we have enough ETH
    try {
      const ethBalance = await getTokenBalance(BASE_TOKEN);
      if (ethBalance > MIN_NATIVE_BALANCE * 2) {
        const amountToSwap = (ethBalance - MIN_NATIVE_BALANCE) * swapFraction;
        
        if (amountToSwap > 0) {
          const randomToken = tokens[Math.floor(Math.random() * tokens.length)];
          console.log(chalk.cyan(`[i] Selected random token for ETH swap: ${randomToken}`));
          
          try {
            await swap(provider, wallet, router, BASE_TOKEN, randomToken, amountToSwap);
            await sleep(Math.random() * 5000 + 3000);
          } catch (e) {
            console.log(chalk.red(`[!] Failed to swap ${BASE_TOKEN} to ${randomToken}: ${e.message}`));
          }
        } else {
          console.log(chalk.yellow(`[!] Not enough ${BASE_TOKEN} to swap after keeping minimum balance`));
        }
      }
    } catch (error) {
      console.log(chalk.red(`[!] Error in ETH to tokens swap: ${error.message}`));
    }

    // Tokens to ETH - try each token that has a balance
    for (const token of tokens) {
      try {
        const tokenBalance = await getTokenBalance(token);
        if (tokenBalance > 0) {
          const swapAmount = tokenBalance * 0.5;
          await swap(provider, wallet, router, token, BASE_TOKEN, swapAmount);
          await sleep(Math.random() * 5000 + 3000);
        }
      } catch (error) {
        console.log(chalk.red(`[!] Error swapping ${token} to ETH: ${error.message}`));
        continue;
      }
    }
    
    await sleep(10000);
  }

  // Final step: Check all token balances and swap to ETH if non-zero
  console.log(chalk.cyan("\n?? Final Balance Check: Swapping all remaining tokens to ETH"));
  await showBalances(provider, wallet);

  for (const token of tokens) {
    try {
      const tokenBalance = await getTokenBalance(token);
      if (tokenBalance > 0) {
        console.log(chalk.cyan(`[i] Found non-zero balance for ${token}: ${tokenBalance}. Swapping to ETH...`));
        // Swap the entire balance
        await swap(provider, wallet, router, token, BASE_TOKEN, tokenBalance);
        console.log(chalk.green(`[?] Successfully swapped all ${token} to ETH`));
        await sleep(Math.random() * 5000 + 3000); // Delay between swaps
      } else {
        console.log(chalk.blue(`[i] ${token} balance is 0. No swap needed.`));
      }
    } catch (error) {
      console.log(chalk.red(`[!] Failed to swap remaining ${token} to ETH: ${error.message}`));
      continue;
    }
  }

  // Show final balances
  console.log(chalk.cyan("\n?? Final Wallet Balances After Swapping All Tokens to ETH:"));
  await showBalances(provider, wallet);
  console.log(chalk.green(`\n? All ${rounds} Swap Rounds Completed and Remaining Tokens Swapped to ETH!`));
};

const mainMenu = async () => {
  printHeader();
  await getPrivateKey();

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: chalk.cyan("?? MegaETH-GTE Auto Swap Menu"),
        choices: [
          { name: "?? Show Wallet Balances", value: "showBalances" },
          { name: "?? Start Swap", value: "swap" },
          { name: "?? Exit", value: "exit" },
        ],
      },
    ]);

    if (action === "showBalances") {
      await showBalances(provider, wallet);
    } else if (action === "swap") {
      await swapMenu();
    } else if (action === "exit") {
      console.log(chalk.red("?? Exiting MegaETH-GTE Auto Swap. Goodbye!"));
      process.exit(0);
    }
  }
};

// Run the bot
const main = async () => {
  try {
    await mainMenu();
  } catch (e) {
    console.error(chalk.red("\nError: " + e.message));
    process.exit(1);
  }
};

if (require.main === module) {
  main();
}