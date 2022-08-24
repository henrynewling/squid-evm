// src/processor.ts
import { lookupArchive } from "@subsquid/archive-registry";
import { Store, TypeormDatabase } from "@subsquid/typeorm-store";
import {
  BatchContext,
  BatchProcessorItem,
  EvmLogEvent,
  SubstrateBatchProcessor,
  SubstrateBlock,
} from "@subsquid/substrate-processor";
import { In } from "typeorm";
import {
  CHAIN_NODE,
  arcticTokenContract,
  myTokenContract,
  getContractEntity,
  getTokenURI,
  contractMapping,
} from "./contract";
import { Owner, Token, Transfer, Approval } from "./model";
import * as erc721 from "./abi/erc721";

const database = new TypeormDatabase();
const processor = new SubstrateBatchProcessor()
  .setBatchSize(500)              //maximal number of blocks fetched from the data source in a single request
  .setBlockRange({ from: 1000 }) // Limits the range of block to be processed
  .setDataSource({
    chain: CHAIN_NODE,
    archive: 'http://localhost:8888/graphql',
  })
  .addEvmLog(myTokenContract.address, {
    range: { from: 1000},
    filter: [
      [
        erc721.events["Transfer(address,address,uint256)"].topic,
        erc721.events["Approval(address,address,uint256)"].topic
      ]
  ],
  })
  .addEvmLog(arcticTokenContract.address, {
    range: { from: 1000},
    filter: [
      [
        erc721.events["Transfer(address,address,uint256)"].topic,
        erc721.events["Approval(address,address,uint256)"].topic
      ]
  ],
  })

type Item = BatchProcessorItem<typeof processor>;
type Context = BatchContext<Store, Item>;

processor.run(database, async (ctx) => {
  const transfersData: TransferData[] = [];
  const approvalData: ApproveData[] = [];

  for (const block of ctx.blocks) {
    for (const item of block.items) {
      if (item.name === "EVM.Log") {
        switch(item.event.args.topics[0]) {
          case erc721.events["Transfer(address,address,uint256)"].topic:
            const transfer = handleTransfer(block.header, item.event)
            transfersData.push(transfer);
            break;
          case erc721.events["Approval(address,address,uint256)"].topic:
            const approval = handleApproval(block.header, item.event);
            approvalData.push(approval);
            break;
          default:
        }
      }
    }
  }

  await saveTransfers(ctx, transfersData);
  await saveApproval(ctx, approvalData);
});

type TransferData = {
  id: string;
  from: string;
  to: string;
  token: string;
  timestamp: bigint;
  block: number;
  transactionHash: string;
  contractAddress: string;
};

type ApproveData = {
  id: string;
  owner: string;
  approved: string;
  token: string;
  timestamp: bigint;
  block: number;
  transactionHash: string;
  contractAddress: string;
};

function handleTransfer(
  block: SubstrateBlock,
  event: EvmLogEvent
): TransferData {
  const { from, to, tokenId } = erc721.events[
    "Transfer(address,address,uint256)"
  ].decode(event.args);

  const transfer: TransferData = {
    id: event.id,
    token: tokenId.toString(),
    from,
    to,
    timestamp: BigInt(block.timestamp),
    block: block.height,
    transactionHash: event.evmTxHash,
    contractAddress: event.args.address,
  };

  return transfer;
}

function handleApproval(
  block: SubstrateBlock,
  event: EvmLogEvent
): ApproveData {
  const { owner, approved, tokenId } = erc721.events[
    "Approval(address,address,uint256)"
  ].decode(event.args);

  const approval: ApproveData = {
    id: event.id,
    token: tokenId.toString(),
    owner,
    approved,
    timestamp: BigInt(block.timestamp),
    block: block.height,
    transactionHash: event.evmTxHash,
    contractAddress: event.args.address,
  };

  return approval;
}

async function saveTransfers(ctx: Context, transfersData: TransferData[]) {
  const tokensIds: Set<string> = new Set();
  const ownersIds: Set<string> = new Set();

  for (const transferData of transfersData) {
    tokensIds.add(transferData.token);
    ownersIds.add(transferData.from);
    ownersIds.add(transferData.to);
  }

  const transfers: Set<Transfer> = new Set();

  const tokens: Map<string, Token> = new Map(
    (await ctx.store.findBy(Token, { id: In([...tokensIds]) })).map((token) => [
      token.id,
      token,
    ])
  );

  const owners: Map<string, Owner> = new Map(
    (await ctx.store.findBy(Owner, { id: In([...ownersIds]) })).map((owner) => [
      owner.id,
      owner,
    ])
  );

  for (const transferData of transfersData) {
    let from = owners.get(transferData.from);
    if (from == null) {
      from = new Owner({ id: transferData.from, balance: 0n });
      owners.set(from.id, from);
    }

    let to = owners.get(transferData.to);
    if (to == null) {
      to = new Owner({ id: transferData.to, balance: 0n });
      owners.set(to.id, to);
    }

    let token = tokens.get(`${contractMapping.get(transferData.contractAddress)?.contractModel.symbol || ""}-${transferData.token}`);
    if (token == null) {
      token = new Token({
        id: `${contractMapping.get(transferData.contractAddress)?.contractModel.symbol || ""}-${transferData.token}`,
        uri: await getTokenURI(transferData.token, transferData.contractAddress),
        contract: await getContractEntity(ctx.store, transferData.contractAddress),
      });
      tokens.set(token.id, token);
    }
    token.owner = to;

    const { id, block, transactionHash, timestamp } = transferData;

    const transfer = new Transfer({
      id,
      block,
      timestamp,
      transactionHash,
      from,
      to,
      token,
    });

    transfers.add(transfer);
  }

  await ctx.store.save([...owners.values()]);
  await ctx.store.save([...tokens.values()]);
  await ctx.store.save([...transfers]);
}
async function saveApproval(ctx: Context, approvalData: ApproveData[]) {
  const tokensIds: Set<string> = new Set();
  const ownersIds: Set<string> = new Set();

  for (const approveData of approvalData) {
    tokensIds.add(approveData.token);
    ownersIds.add(approveData.owner);
    ownersIds.add(approveData.approved);
  }

  const approval: Set<Approval> = new Set();

  const tokens: Map<string, Token> = new Map(
    (await ctx.store.findBy(Token, { id: In([...tokensIds]) })).map((token) => [
      token.id,
      token,
    ])
  );

  const owners: Map<string, Owner> = new Map(
    (await ctx.store.findBy(Owner, { id: In([...ownersIds]) })).map((owner) => [
      owner.id,
      owner,
    ])
  );

  for (const approveData of approvalData) {
    let owner = owners.get(approveData.owner);
    if (owner == null) {
      owner = new Owner({ id: approveData.owner, balance: 0n });
      owners.set(owner.id, owner);
    }

    let approved = owners.get(approveData.approved);
    if (approved == null) {
      approved = new Owner({ id: approveData.approved, balance: 0n });
      owners.set(approved.id, approved);
    }

    let token = tokens.get(`${contractMapping.get(approveData.contractAddress)?.contractModel.symbol || ""}-${approveData.token}`);
    if (token == null) {
      token = new Token({
        id: `${contractMapping.get(approveData.contractAddress)?.contractModel.symbol || ""}-${approveData.token}`,
        uri: await getTokenURI(approveData.token, approveData.contractAddress),
        contract: await getContractEntity(ctx.store, approveData.contractAddress),
      });
      tokens.set(token.id, token);
    }
    token.owner = approved;

    const { id, block, transactionHash, timestamp } = approveData;

    const approve = new Approval({
      id,
      block,
      timestamp,
      transactionHash,
      owner,
      approved,
      token,
    });

    approval.add(approve);
  }

  await ctx.store.save([...owners.values()]);
  await ctx.store.save([...tokens.values()]);
  await ctx.store.save([...approval]);
}
