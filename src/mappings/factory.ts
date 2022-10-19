import { ethereum, Bytes, log } from "@graphprotocol/graph-ts";
import { BigInt, Address } from "@graphprotocol/graph-ts";
import {
  VaultCreated, SetAccessManager,
  SetFeesManager,
  SetHarvester,
  SetSwapContracts,
  AddTokensAndPriceFeeds,
  RemoveTokensAndPriceFeeds,
  SetSwapAdapter,
  OwnershipTransferred,
} from "../types/Factory/Factory";

import { Vault, Factory } from '../types/schema';
import { Vault as VaultContract } from "../types/Factory/Vault";
import { Factory as FactoryContract } from "../types/Factory/Factory";
import { Vault as VaultTemplate } from "../types/templates";
import { FACTORY_ADDRESS, ZERO_BI, SNAPSHOT_TIMEFRAME } from './helpers';
import { VaultSnapshot } from "../types/schema";

import { store } from '@graphprotocol/graph-ts'


/**
 * This function should be called only once at the first vault created, when the subgraph isn't yet deployed
 * @param event The vault creation event
 * @returns The create factory entity
 */
export function _createFactory(event: VaultCreated): Factory {
  log.debug("CALL : _createFactory", []);
  const factory = new Factory(FACTORY_ADDRESS);
  factory.vaultCount = 0;
  const bindedFactory = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS));
  // Tokens
  const tokens = bindedFactory.getWhitelistedTokens();
  const tokensArray = new Array<Bytes>(tokens.length);
  for (let x = 0; x < tokens.length; x++) tokensArray[x] = tokens[x];
  factory.tokens = tokensArray;
  // Other Addresses
  factory.feesManager = bindedFactory.feesManager();
  factory.accessManager = bindedFactory.accessManager();
  factory.harvester = bindedFactory.harvester();
  factory.swapRouter = bindedFactory.swapRouter();
  factory.swapProxy = bindedFactory.swapProxy();
  factory.swapAdapter = bindedFactory.swapAdapter();
  factory.lastSnapshotBlockTimestamp = event.block.timestamp;
  factory.lastSnapshotBlockNumber = event.block.number;
  factory.save();

  return factory;
}

/**
 * Update the full content of a vault
 * @param vAddress His address
 * @param vault The instance itself
 * @returns 
 */
export const updateVault = (vault: Vault): Vault => {
  log.debug("CALL : updateVault", []);

  // const vAddress = Address.fromString(vault.id)
  const bindedFactory = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS));
  const bindedVault = VaultContract.bind(Address.fromString(vault.id));

  // Update Vault Storage
  const tokensLength = bindedVault.tokensLength().toI32();
  const tokens = new Array<Bytes>(tokensLength);
  const tokensPriceFeedAddress = new Array<Bytes>(tokensLength); // String != string
  const tokensPriceFeedPrecision = new Array<BigInt>(tokensLength);
  const tokensDenominator = new Array<BigInt>(tokensLength);
  for (let x = 0; x < tokensLength; x++) {
    const tokenData = bindedVault.tokens(BigInt.fromI32(x));
    tokens[x] = tokenData.value0
    tokensPriceFeedAddress[x] = tokenData.value1;
    tokensPriceFeedPrecision[x] = BigInt.fromI32(tokenData.value2);
    tokensDenominator[x] = tokenData.value3;
  };

  vault.tokens = tokens;
  vault.tokensPriceFeedAddress = tokensPriceFeedAddress
  vault.tokensPriceFeedPrecision = tokensPriceFeedPrecision;
  vault.tokensDenominator = tokensDenominator;

  // log.debug("CALL :  bindedFactory._address: {}", [bindedFactory._address.toHexString()]);
  // log.debug("CALL :  bindedFactory._name: {}", [bindedFactory._name]);
  // log.debug("CALL :  bindedFactory.harvester: {}", [bindedFactory.harvester().toHexString()]);

  // RoLes

  const vaultRoLes = bindedFactory.getRolesPerVault(Address.fromString(vault.id));

  const admins = new Array<Bytes>(vaultRoLes.value1.length);
  const strategists = new Array<Bytes>(vaultRoLes.value2.length);
  const harvesters = new Array<Bytes>(vaultRoLes.value3.length);
  for (let x = 0; x < vaultRoLes.value1.length; x++) admins[x] = vaultRoLes.value1[x];
  for (let x = 0; x < vaultRoLes.value2.length; x++) strategists[x] = vaultRoLes.value2[x];
  for (let x = 0; x < vaultRoLes.value3.length; x++) harvesters[x] = vaultRoLes.value3[x];

  vault.admins = admins;
  vault.strategists = strategists;
  vault.harvesters = harvesters;

  // Config Props
  const configProps = bindedVault.getConfigProps();
  vault.paused = configProps.paused;
  vault.verified = configProps.verified;
  vault.name = configProps.name;
  vault.description = configProps.description;

  // Constant Props
  const constantProps = bindedVault.getConstantProps();
  vault.factoryAddress = constantProps.factory;
  vault.createdAt = constantProps.createdAt;
  vault.share = constantProps.share;

  // Fees Props
  const feesProps = bindedVault.getFeesProps();
  vault.beneficiary = feesProps.beneficiary; // Strange
  vault.exitFees = feesProps.exitFees;
  vault.managementFeesRate = feesProps.managementFeesRate;
  vault.managementFeesToStrategist = feesProps.managementFeesToStrategist;
  vault.performanceFeesRate = feesProps.performanceFeesRate;
  vault.performanceFeesToStrategist = feesProps.performanceFeesToStrategist;

  // History Props
  const historyProps = bindedVault.getHistoryProps();
  vault.highWaterMark = historyProps.highWaterMark;
  vault.prevRebalanceSignals = historyProps.prevRebalanceSignals;
  vault.prevSwap = historyProps.prevSwap;
  vault.prevMngHarvest = historyProps.prevMngHarvest;

  // Security Props
  const securityProps = bindedVault.getSecurityProps();
  vault.maxAUM = securityProps.maxAUM;
  vault.maxLossSwap = securityProps.maxLossSwap;
  vault.minAmountDeposit = securityProps.minAmountDeposit;
  vault.maxAmountDeposit = securityProps.maxAmountDeposit;
  vault.minFrequencySwap = securityProps.minFrequencySwap;
  vault.minSecurityTime = securityProps.minSecurityTime;
  vault.minHarvestThreshold = securityProps.minHarvestThreshold;

  // State Left
  const vaultState = bindedFactory.getVaultState(Address.fromString(vault.id));
  vault.balances = vaultState.value6;
  vault.positions = vaultState.value7;
  vault.tvl = vaultState.value8;
  vault.sharePrice = vaultState.value9;
  const ongoingFees = vaultState.value10;
  vault.ongoingManagementFees = ongoingFees[0];
  vault.ongoingPerformanceFees = ongoingFees[1];

  vault.save();

  return vault;
}

/**
 * Internal handler to create the vault
 * @param event Event of creation
 * @param factory Factory instance
 */
export function _createVault(event: VaultCreated, factory: Factory): Vault {
  /// Factory Info
  let vault = new Vault(event.params.vault.toHexString()) as Vault;
  vault.factory = factory.id;
  vault.vault = event.params.vault;
  vault.creator = event.transaction.from;
  vault.shareTransferability = false;
  vault.accManagementFeesToDAO = ZERO_BI;
  vault.accPerformanceFeesToDAO = ZERO_BI;
  vault.accManagementFeesToStrategists = ZERO_BI;
  vault.accPerformanceFeesToStrategists = ZERO_BI;
  vault.depositsCount = 0;
  vault.rebalancesCount = 0;
  vault.redemptionsCount = 0;
  const updatedVault = updateVault(vault);
  updatedVault.save();
  return vault;
}

/**
 * Create a vault, via the factory event
 * @param event /
 */
export function handleCreateVault(event: VaultCreated): void {
  log.debug("CALL : handleCreateVault", []);
  // Factory (created when the first vault is created)
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) factory = _createFactory(event);
  factory.vaultCount = factory.vaultCount + 1;
  factory.save();
  // Vault
  const vault = _createVault(event, factory);
  VaultTemplate.create(event.params.vault);
  vault.save();
  factory.save();
}

/**
 * Take a snapshot for each vault
 * @param factory Factory instance
 * @param vaultAddress Vault address
 * @param block Block of the event
 * @param triggeredByEvent Wethever the snapshot is triggered by an event or the `handbleBlock` handler. To be used in the frontend possibly
 */
export function newSnapshot(
  factory: Factory,
  vaultAddress: Address,
  block: ethereum.Block,
  triggeredByEvent: boolean,
): void {
  const vault = VaultContract.bind(vaultAddress);
  const entityName = FACTORY_ADDRESS + "-" + vaultAddress.toHexString() + "-" + block.number.toString();
  const status = vault.getVaultStatus();
  const tokensLength = vault.tokensLength().toI32();
  const assetsPrices = new Array<BigInt>(tokensLength);
  const newTokens = new Array<Bytes>(tokensLength);
  for (let y = 0; y < tokensLength; y++) {
    const asset = vault.tokens(BigInt.fromI32(y));
    const price = vault.getLatestPrice(asset.value1);
    assetsPrices[y] = price;
    newTokens[y] = asset.value0;
  }
  const assetsBalances = vault.getVaultBalances();
  const snapshot = new VaultSnapshot(entityName);
  snapshot.factory = factory.id;
  snapshot.vault = vaultAddress.toHexString();
  snapshot.assetsBalances = assetsBalances;
  snapshot.assetsPrices = assetsPrices;
  snapshot.tokens = newTokens;
  snapshot.positions = status.value0;
  snapshot.tvl = status.value1;
  snapshot.sharePrice = status.value2;
  snapshot.pendingPerfFees = vault.getManagementFees().value0;
  snapshot.pendingMngFees = vault.getPerformanceFees().value0;
  snapshot.timestamp = block.timestamp;
  snapshot.triggeredByEvent = triggeredByEvent;
  snapshot.save();
}

/**
 * Handle the modification of the access manager contract - Might not be used because we can upgrade the access manager itself
 * @param event /
 * @returns /
 */
export function handleSetAccessManager(event: SetAccessManager): void {
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return; // Not possible
  factory.accessManager = event.params.newAccessManager;
  factory.save();
}

/**
 * Handle the modification of the fees manager contract - Might not be used because we can upgrade the fees manager itself
 * @param event /
 * @returns /
 */
export function handleSetFeesManager(event: SetFeesManager): void {
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return; // Not possible
  factory.feesManager = event.params.newFeesManager;
  factory.save();
}

/**
 * Handle the modification of the default fees harvester address
 * @param event /
 * @returns /
 */
export function handleSetHarvester(event: SetHarvester): void {
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return; // Not possible
  factory.harvester = event.params.newHarvester;
  factory.save();

}

/**
 * Handle the modification of swap contracts, used by vaults
 * @param event /
 * @returns /
 */
export function handleSetSwapContracts(event: SetSwapContracts): void {
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return; // Not possible
  factory.swapProxy = event.params.newSwapProxy;
  factory.swapRouter = event.params.newSwapRouter;
  factory.save();
}

/**
 * Update the factory tokens at removal of tokens
 * @param event /
 * @returns /
 */
export function handleAddTokensAndPriceFeeds(event: AddTokensAndPriceFeeds): void {
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return; // Not possible
  const factoryContract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS));
  const currentTokens = factoryContract.getWhitelistedTokens();  // Post Remove
  const tmp = new Array<Bytes>(currentTokens.length);
  for (let x = 0; x < currentTokens.length; x++) tmp[x] = currentTokens[x];
  factory.tokens = tmp;
  factory.save();
}

/**
 * Update the factory tokens at removal of tokens
 * @param event /
 * @returns /
 */
export function handleRemoveTokensAndPriceFeeds(event: RemoveTokensAndPriceFeeds): void {
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return; // Not possible
  const factoryContract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS));
  const currentTokens = factoryContract.getWhitelistedTokens();  // Post Remove
  const tmp = new Array<Bytes>(currentTokens.length);
  for (let x = 0; x < currentTokens.length; x++) tmp[x] = currentTokens[x];
  factory.tokens = tmp;
  factory.save();
}

/**
 * 
 * @param event 
 * @returns 
 */
export function handleSetSwapAdapter(event: SetSwapAdapter): void {
  let factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return; // Not possible
  factory.swapAdapter = event.params.newSwapAdapter;
  factory.save();
}

/**
 * New block handler
 * We also 
 * @notice It's normal that the graph will create tons of snapshots during the deploy/sync time, because it look over tons of past blocks
 * @param block Current Block
 * @returns /
 */
export function handleNewBlock(block: ethereum.Block): void {
  const factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) {
    log.debug("handleNewBlock : No Factory yet", []);
    return;
  }
  if (!snapshotOrNot(block) == false) return;
  const factoryStorage = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS));
  const factoryState = factoryStorage.getFactoryState();
  const vaults = factoryState.value0;
  for (let x = 0; x < vaults.length; x++) {
    const vAddress = vaults[x];
    newSnapshot(factory, vAddress, block, false);
    let vault = Vault.load(vAddress.toString());
    if (vault === null) continue;
    updateVault(vault);
  }
  factory.lastSnapshotBlockTimestamp = block.timestamp;
  factory.lastSnapshotBlockNumber = block.number;
  factory.save();
}


/**
 * Tells if we should snapshot or not -- We snapshot only every 1 hour
 * @param block /
 * @returns /
 */
export function snapshotOrNot(block: ethereum.Block): boolean {
  const factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) {
    log.debug("snapshotOrNot : No Factory yet", []);
    return false
  }
  const lastSnapTimestamp = factory.lastSnapshotBlockTimestamp;
  const currentTime = block.timestamp;
  const elaspedTime = currentTime.minus(lastSnapTimestamp)
  const skipSnapshot = elaspedTime.le(SNAPSHOT_TIMEFRAME);
  // log.debug("CALL : currentTime: {}", [currentTime.toString()]);
  // log.debug("CALL : lastSnapTimestamp: {}", [lastSnapTimestamp.toString()]);
  // log.debug("CALL : elaspedTime: {}", [elaspedTime.toString()]);
  // log.debug("CALL : SNAPSHOT_TIMEFRAME: {}", [SNAPSHOT_TIMEFRAME.toString()]);
  // log.debug("CALL : skipSnapshot: {}", [skipSnapshot.toString()]);
  return skipSnapshot;
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  const factory = Factory.load(FACTORY_ADDRESS);
  if (factory === null) return;
  // Nothing to do. We don't store the owner
}