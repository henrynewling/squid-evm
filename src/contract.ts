// src/contract.ts
import { Store } from "@subsquid/typeorm-store";
import { ethers } from "ethers";
import * as erc721 from "./abi/erc721";
import { Contract } from "./model";

export const CHAIN_NODE = "wss://arctic-archive.icenetwork.io:9944";

interface ContractInfo {
  ethersContract: ethers.Contract;
  contractModel: Contract;
}

export const contractMapping: Map<string, ContractInfo> = new Map<
  string,
  ContractInfo
>();

export const arcticTokenContract = new ethers.Contract(
  "0x822f31039f5809fa9dd9877c4f91a46de71cde63".toLowerCase(),
  erc721.abi,
  new ethers.providers.WebSocketProvider(CHAIN_NODE)
);

contractMapping.set(arcticTokenContract.address, {
  ethersContract: arcticTokenContract,
  contractModel: {
    id: arcticTokenContract.address,
    name: "ArcticToken",
    symbol: "ARTK",
    totalSupply: 3n,
    mintedTokens: [],
  },
});

export const myTokenContract = new ethers.Contract(
  "0x581522ca7b73935e4ad8c165d5635f5e15a7658d".toLowerCase(),
  erc721.abi,
  new ethers.providers.WebSocketProvider(CHAIN_NODE)
);

contractMapping.set(myTokenContract.address, {
  ethersContract: myTokenContract,
  contractModel: {
    id: myTokenContract.address,
    name: "MyToken",
    symbol: "MTK",
    totalSupply: 0n,
    mintedTokens: [],
  },
});



export function createContractEntity(address: string): Contract {
  return new Contract(contractMapping.get(address)?.contractModel);
}

const contractAddresstoModel: Map<string, Contract> = new Map<
string,
Contract
>();

export async function getContractEntity(
  store: Store,
  address: string
): Promise<Contract | undefined> {
  if (contractAddresstoModel.get(address) == null) {
    let contractEntity = await store.get(Contract, address);
    if (contractEntity == null) {
      contractEntity = createContractEntity(address);
      await store.insert(contractEntity);
      contractAddresstoModel.set(address, contractEntity)
    }
  }
  
  return contractAddresstoModel.get(address);
}

export async function getTokenURI(
  tokenId: string,
  address: string
): Promise<string> {
  return retry(async () =>
    timeout(contractMapping.get(address)?.ethersContract?.tokenURI(tokenId))
  );
}

async function timeout<T>(res: Promise<T>, seconds = 30): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: any = setTimeout(() => {
      timer = undefined;
      reject(new Error(`Request timed out in ${seconds} seconds`));
    }, seconds * 1000);

    res
      .finally(() => {
        if (timer != null) {
          clearTimeout(timer);
        }
      })
      .then(resolve, reject);
  });
}

async function retry<T>(promiseFn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await promiseFn();
    } catch (err) {
      console.log(err);
    }
  }
  throw new Error(`Error after ${attempts} attempts`);
}
