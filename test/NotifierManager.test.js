/* eslint-disable @typescript-eslint/no-var-requires,no-undef */
const upgrades = require('@openzeppelin/truffle-upgrades')
const {
  expectEvent,
  expectRevert,
  constants
} = require('@openzeppelin/test-helpers')
const expect = require('chai').expect
const BigNumber = require('bignumber.js')

const NotifierManager = artifacts.require('NotifierManager')
const NotifierManagerV2 = artifacts.require('NotifierManagerV2')

const ERC20 = artifacts.require('MockERC20')

function fixSignature (signature) {
  // in geth its always 27/28, in ganache its 0/1. Change to 27/28 to prevent
  // signature malleability if version is 0/1
  // see https://github.com/ethereum/go-ethereum/blob/v1.8.23/internal/ethapi/api.go#L465
  let v = parseInt(signature.slice(130, 132), 16)

  if (v < 27) {
    v += 27
  }
  const vHex = v.toString(16)
  return signature.slice(0, 130) + vHex
}

contract('NotifierManager', ([Owner, Consumer, Provider, NotRegisteredProvider, NotWhitelistedProvider]) => {
  const subscription = { someDAta: 'test' }
  const subscriptionHash = web3.utils.sha3(JSON.stringify(subscription))
  const subscriptionNativeHash = web3.utils.sha3(JSON.stringify({ testData: '1' }))
  const subscriptionERC20Hash = web3.utils.sha3(JSON.stringify({ testData: '2' }))
  const url = 'testUrl'
  let notifierManager
  let token
  let signature

  beforeEach(async function () {
    notifierManager = await upgrades.deployProxy(NotifierManager, [])

    token = await ERC20.new('myToken', 'mT', Owner, 100000, { from: Owner })

    await notifierManager.setWhitelistedTokens(constants.ZERO_ADDRESS, true, { from: Owner })
    await notifierManager.setWhitelistedTokens(token.address, true, { from: Owner })

    await notifierManager.setWhitelistedProvider(Provider, true, { from: Owner })
    await notifierManager.setWhitelistedProvider(NotRegisteredProvider, true, { from: Owner })

    await token.transfer(Consumer, 10000, { from: Owner })

    signature = fixSignature(await web3.eth.sign(subscriptionHash, Provider))
  })

  describe('White list of providers', () => {
    it('should not be able to register provider if not whitelisted', async () => {
      await expectRevert(notifierManager.registerProvider('testUrl', { from: NotWhitelistedProvider }),
        'NotifierManager: provider is not whitelisted'
      )
    })
    it('should not be able to create subscription for not whitelisted provider', async () => {
      await expectRevert(notifierManager.createSubscription(NotWhitelistedProvider, subscriptionHash, signature, constants.ZERO_ADDRESS, 0, { from: NotWhitelistedProvider, value: 1 }),
        'NotifierManager: provider is not whitelisted'
      )
    })
    it.skip('should not be able to deposit for subscription for not whitelisted provider', async () => {
      await expectRevert(notifierManager.depositFunds(NotWhitelistedProvider, subscriptionHash, constants.ZERO_ADDRESS, 0, { from: NotWhitelistedProvider, value: 1 }),
        'NotifierManager: provider is not whitelisted'
      )
    })
    it('should not be able to whitelist provider by not owner', async () => {
      await expectRevert(notifierManager.setWhitelistedProvider(NotWhitelistedProvider, true, { from: NotWhitelistedProvider }), 'Ownable: caller is not the owner')
    })
    it('should be able to register provider by whitelisted provider', async () => {
      await notifierManager.setWhitelistedProvider(Provider, true, { from: Owner })

      const url = 'testUrl'
      const receipt = await notifierManager.registerProvider(url, { from: Provider })

      expectEvent(receipt, 'ProviderRegistered', {
        provider: Provider,
        url
      })
    })
  })

  describe('registerProvider', () => {
    it('should be able to register provider', async () => {
      const url = 'testUrl'
      const receipt = await notifierManager.registerProvider(url, { from: Provider })

      expectEvent(receipt, 'ProviderRegistered', {
        provider: Provider,
        url
      })
    })
    it('should not be able to register provider without url', async () => {
      await expectRevert(notifierManager.registerProvider('', { from: Provider }), 'NotifierManager: URL can not be empty')
    })
    it('should not be able to register provider which is not whitelisted', async () => {
      await expectRevert(
        notifierManager.registerProvider('test', { from: NotWhitelistedProvider }),
        'NotifierManager: provider is not whitelisted'
      )
    })
  })

  describe('createSubscription', () => {
    it('should be able to create subscription', async () => {
      expectEvent(await notifierManager.registerProvider('testUrl', { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url: 'testUrl'
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        subscriptionHash,
        signature,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: subscriptionHash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })
    })
    it('should be able to create subscription (ERC20)', async () => {
      expectEvent(await notifierManager.registerProvider('testUrl', { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url: 'testUrl'
      })

      await token.approve(notifierManager.address, 1, { from: Consumer })
      const receipt2 = await notifierManager.createSubscription(
        Provider,
        subscriptionHash,
        signature,
        token.address,
        1,
        { from: Consumer }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: subscriptionHash,
        provider: Provider,
        token: token.address,
        amount: '1',
        consumer: Consumer
      })
    })
    it('should not be able to create subscription: token not whitelisted', async () => {
      await expectRevert(
        notifierManager.createSubscription(
          Provider,
          subscriptionHash,
          signature,
          Owner,
          1,
          { from: Consumer }
        ),
        'NotifierManager: not possible to interact with this token'
      )
    })
    it('should not be able to create subscription: provider not whitelisted', async () => {
      await expectRevert(
        notifierManager.createSubscription(
          NotWhitelistedProvider,
          subscriptionHash,
          signature,
          constants.ZERO_ADDRESS,
          1,
          { from: Consumer }
        ),
        'NotifierManager: provider is not whitelisted'
      )
    })
    it('should not be able to create subscription: amount < 0', async () => {
      expectEvent(await notifierManager.registerProvider('testUrl', { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url: 'testUrl'
      })
      await expectRevert(
        notifierManager.createSubscription(
          Provider,
          subscriptionHash,
          signature,
          constants.ZERO_ADDRESS,
          1,
          { from: Consumer, value: 0 }
        ),
        'NotifierManager: You should deposit funds to be able to create subscription'
      )
      await expectRevert(
        notifierManager.createSubscription(
          Provider,
          subscriptionHash,
          signature,
          token.address,
          0,
          { from: Consumer, value: 1 }
        ),
        'NotifierManager: You should deposit funds to be able to create subscription'
      )
    })
    it('should not be able to create subscription: not registered provider', async () => {
      await expectRevert(
        notifierManager.createSubscription(
          NotRegisteredProvider,
          subscriptionHash,
          signature,
          constants.ZERO_ADDRESS,
          0,
          { from: Consumer, value: 1 }
        ),
        'NotifierManager: Provider is not registered'
      )
    })
    it('should not be able to create subscription: subscription already exist', async () => {
      const url = 'testUrl'
      const subscriptionHash = web3.utils.sha3(JSON.stringify({ test: 'test' }))
      const signature = fixSignature(await web3.eth.sign(subscriptionHash, Provider))
      const receipt = await notifierManager.registerProvider(url, { from: Provider })

      expectEvent(receipt, 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        subscriptionHash,
        signature,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: subscriptionHash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })
      await expectRevert(
        notifierManager.createSubscription(
          Provider,
          subscriptionHash,
          signature,
          constants.ZERO_ADDRESS,
          2,
          { from: Consumer, value: 2 }
        ),
        'NotifierManager: Subscription already exist'
      )
    })
    it('should not be able to create subscription: invalid signature', async () => {
      const url = 'testUrl'
      const subscriptionHash = web3.utils.sha3(JSON.stringify({ test: 'test' }))
      const signature = fixSignature(await web3.eth.sign(subscriptionHash, Owner))
      const receipt = await notifierManager.registerProvider(url, { from: Provider })

      expectEvent(receipt, 'ProviderRegistered', {
        provider: Provider,
        url
      })

      await expectRevert(
        notifierManager.createSubscription(
          Provider,
          subscriptionHash,
          signature,
          constants.ZERO_ADDRESS,
          2,
          { from: Consumer, value: 2 }
        ),
        'NotifierManager: Invalid signature'
      )
    })
  })

  describe.skip('depositFunds', () => {
    it('should be able to deposit: native', async () => {
      const signatureNative = fixSignature(await web3.eth.sign(subscriptionNativeHash, Provider))
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        subscriptionNativeHash,
        signatureNative,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: subscriptionNativeHash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      const receipt = await notifierManager.depositFunds(
        Provider,
        subscriptionNativeHash,
        constants.ZERO_ADDRESS,
        1,
        { from: Consumer, value: 1 }
      )
      expectEvent(receipt, 'FundsDeposit', {
        provider: Provider,
        hash: subscriptionNativeHash,
        amount: '1',
        token: constants.ZERO_ADDRESS
      })
    })
    it('should be able to deposit: ERC20', async () => {
      const signatureERC20 = fixSignature(await web3.eth.sign(subscriptionERC20Hash, Provider))
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      await token.approve(notifierManager.address, 2, { from: Consumer })
      const receipt = await notifierManager.createSubscription(
        Provider,
        subscriptionERC20Hash,
        signatureERC20,
        token.address,
        2,
        { from: Consumer }
      )
      expectEvent(receipt, 'SubscriptionCreated', {
        hash: subscriptionERC20Hash,
        provider: Provider,
        token: token.address,
        amount: '2',
        consumer: Consumer
      })

      await token.approve(notifierManager.address, 3, { from: Consumer })
      const receipt2 = await notifierManager.depositFunds(
        Provider,
        subscriptionERC20Hash,
        token.address,
        3,
        { from: Consumer }
      )
      expectEvent(receipt2, 'FundsDeposit', {
        provider: Provider,
        hash: subscriptionERC20Hash,
        amount: '3',
        token: token.address
      })
    })
    it('should not be able to deposit: provider is not whitelisted', async () => {
      await expectRevert(
        notifierManager.depositFunds(NotWhitelistedProvider, subscriptionHash, constants.ZERO_ADDRESS, 0, { from: Consumer }),
        'NotifierManager: provider is not whitelisted'
      )
    })
    it('should not be able to deposit: token is not whitelisted', async () => {
      await expectRevert(
        notifierManager.depositFunds(Provider, subscriptionHash, Owner, 0, { from: Consumer }),
        'NotifierManager: not possible to interact with this token'
      )
    })
    it('should not be able to deposit: amount < 0', async () => {
      await expectRevert(
        notifierManager.depositFunds(Provider, subscriptionHash, constants.ZERO_ADDRESS, 1, { from: Consumer }),
        'NotifierManager: Nothing to deposit'
      )
      await expectRevert(
        notifierManager.depositFunds(Provider, subscriptionHash, token.address, 0, { from: Consumer, value: 1 }),
        'NotifierManager: Nothing to deposit'
      )
    })
    it('should not be able to deposit: provider is not registered', async () => {
      await expectRevert(
        notifierManager.depositFunds(NotRegisteredProvider, subscriptionHash, constants.ZERO_ADDRESS, 0, { from: Consumer, value: 1 }),
        'NotifierManager: Provider is not registered'
      )
    })
    it('should not be able to deposit: subscription is not exist', async () => {
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })
      await expectRevert(
        notifierManager.depositFunds(Provider, subscriptionHash, constants.ZERO_ADDRESS, 0, { from: Consumer, value: 1 }),
        'NotifierManager: Subscription does not exist'
      )
    })
    it('should not be able to deposit: invalid token for subscription', async () => {
      const signatureNative = fixSignature(await web3.eth.sign(subscriptionNativeHash, Provider))
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        subscriptionNativeHash,
        signatureNative,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: subscriptionNativeHash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      await expectRevert(notifierManager.depositFunds(
        Provider,
        subscriptionNativeHash,
        token.address,
        1,
        { from: Consumer }
      ),
      'NotifierManager: Invalid token for subscription')
    })
  })

  describe('withdrawalFunds', () => {
    it('should be able to withdrawal: native', async () => {
      const signatureNative = fixSignature(await web3.eth.sign(subscriptionNativeHash, Provider))
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        subscriptionNativeHash,
        signatureNative,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: subscriptionNativeHash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      const receipt3 = await notifierManager.withdrawFunds(
        subscriptionNativeHash,
        constants.ZERO_ADDRESS,
        2,
        { from: Provider }
      )
      expectEvent(receipt3, 'FundsWithdrawn', {
        provider: Provider,
        hash: subscriptionNativeHash,
        token: constants.ZERO_ADDRESS,
        amount: '2'
      })
    })
    it('should be able to withdrawal: ERC20', async () => {
      const signatureERC20 = fixSignature(await web3.eth.sign(subscriptionERC20Hash, Provider))
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      await token.approve(notifierManager.address, 2, { from: Consumer })
      const receipt = await notifierManager.createSubscription(
        Provider,
        subscriptionERC20Hash,
        signatureERC20,
        token.address,
        2,
        { from: Consumer }
      )
      expectEvent(receipt, 'SubscriptionCreated', {
        hash: subscriptionERC20Hash,
        provider: Provider,
        token: token.address,
        amount: '2',
        consumer: Consumer
      })

      const tokenBalance = await token.balanceOf(Provider)
      const receipt2 = await notifierManager.withdrawFunds(
        subscriptionERC20Hash,
        token.address,
        2,
        { from: Provider }
      )
      expectEvent(receipt2, 'FundsWithdrawn', {
        provider: Provider,
        hash: subscriptionERC20Hash,
        amount: '2',
        token: token.address
      })
      const tokenBalanceAfter = await token.balanceOf(Provider)
      expect(tokenBalanceAfter.toNumber()).to.be.eql(tokenBalance.toNumber() + 2)
    })
    it('should not be able to withdrawal: provider not registered', async () => {
      await expectRevert(
        notifierManager.withdrawFunds(subscriptionNativeHash, constants.ZERO_ADDRESS, 1, { from: Consumer }),
        'NotifierManager: Provider is not registered'
      )
    })
    it('should not be able to withdrawal: amount < 0', async () => {
      expectEvent(await notifierManager.registerProvider('testUrl', { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url: 'testUrl'
      })
      await expectRevert(
        notifierManager.withdrawFunds(subscriptionNativeHash, constants.ZERO_ADDRESS, 0, { from: Provider }),
        'NotifierManager: Nothing to withdraw'
      )
    })
    it('should not be able to withdrawal: subscription is not exist', async () => {
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      await expectRevert(
        notifierManager.withdrawFunds(
          subscriptionNativeHash,
          constants.ZERO_ADDRESS,
          2,
          { from: Provider }
        ),
        'NotifierManager: Subscription does not exist')
    })
    it('should not be able to withdrawal: invalid token', async () => {
      const hash = web3.utils.sha3(JSON.stringify({ test: '123' }))
      const signature = fixSignature(await web3.eth.sign(hash, Provider))

      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        hash,
        signature,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: hash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      await expectRevert(
        notifierManager.withdrawFunds(
          hash,
          token.address,
          2,
          { from: Provider }
        ),
        'NotifierManager: Invalid token for subscription')
    })
    it('should not be able to withdrawal: amount > subscription.balance', async () => {
      const hash = web3.utils.sha3(JSON.stringify({ test: '1234' }))
      const signature = fixSignature(await web3.eth.sign(hash, Provider))

      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        hash,
        signature,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: hash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      await expectRevert(
        notifierManager.withdrawFunds(
          hash,
          constants.ZERO_ADDRESS,
          10,
          { from: Provider }
        ),
        'NotifierManager: Amount is too big')
    })
  })

  describe('refundFunds', () => {
    it('should be able to refund: native', async () => {
      const signatureNative = fixSignature(await web3.eth.sign(subscriptionNativeHash, Provider))
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        subscriptionNativeHash,
        signatureNative,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: subscriptionNativeHash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      const balanceBefore = await web3.eth.getBalance(Consumer)
      const receipt3 = await notifierManager.refundFunds(
        subscriptionNativeHash,
        constants.ZERO_ADDRESS,
        2,
        { from: Provider }
      )
      expectEvent(receipt3, 'FundsRefund', {
        provider: Provider,
        hash: subscriptionNativeHash,
        token: constants.ZERO_ADDRESS,
        amount: '2'
      })
      const balanceAfter = await web3.eth.getBalance(Consumer)
      expect(balanceAfter).to.be.eql(new BigNumber(balanceBefore).plus(2).toString())
    })
    it('should be able to refund: ERC20', async () => {
      const signatureERC20 = fixSignature(await web3.eth.sign(subscriptionERC20Hash, Provider))
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      await token.approve(notifierManager.address, 2, { from: Consumer })
      const receipt = await notifierManager.createSubscription(
        Provider,
        subscriptionERC20Hash,
        signatureERC20,
        token.address,
        2,
        { from: Consumer }
      )
      expectEvent(receipt, 'SubscriptionCreated', {
        hash: subscriptionERC20Hash,
        provider: Provider,
        token: token.address,
        amount: '2',
        consumer: Consumer
      })

      const tokenBalance = await token.balanceOf(Consumer)
      const receipt2 = await notifierManager.refundFunds(
        subscriptionERC20Hash,
        token.address,
        2,
        { from: Provider }
      )
      expectEvent(receipt2, 'FundsRefund', {
        provider: Provider,
        hash: subscriptionERC20Hash,
        amount: '2',
        token: token.address
      })
      const tokenBalanceAfter = await token.balanceOf(Consumer)
      expect(tokenBalanceAfter.toNumber()).to.be.eql(tokenBalance.toNumber() + 2)
    })
    it('should not be able to refund: provider not registered', async () => {
      await expectRevert(
        notifierManager.refundFunds(subscriptionNativeHash, constants.ZERO_ADDRESS, 1, { from: Consumer }),
        'NotifierManager: Provider is not registered'
      )
    })
    it('should not be able to refund: amount < 0', async () => {
      expectEvent(await notifierManager.registerProvider('testUrl', { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url: 'testUrl'
      })
      await expectRevert(
        notifierManager.refundFunds(subscriptionNativeHash, constants.ZERO_ADDRESS, 0, { from: Provider }),
        'NotifierManager: Nothing to refund'
      )
    })
    it('should not be able to refund: subscription is not exist', async () => {
      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      await expectRevert(
        notifierManager.refundFunds(
          subscriptionNativeHash,
          constants.ZERO_ADDRESS,
          2,
          { from: Provider }
        ),
        'NotifierManager: Subscription does not exist')
    })
    it('should not be able to refund: invalid token', async () => {
      const hash = web3.utils.sha3(JSON.stringify({ test: '123' }))
      const signature = fixSignature(await web3.eth.sign(hash, Provider))

      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        hash,
        signature,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: hash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      await expectRevert(
        notifierManager.refundFunds(
          hash,
          token.address,
          2,
          { from: Provider }
        ),
        'NotifierManager: Invalid token for subscription')
    })
    it('should not be able to refund: amount > subscription.balance', async () => {
      const hash = web3.utils.sha3(JSON.stringify({ test: '1234' }))
      const signature = fixSignature(await web3.eth.sign(hash, Provider))

      expectEvent(await notifierManager.registerProvider(url, { from: Provider }), 'ProviderRegistered', {
        provider: Provider,
        url
      })

      const receipt2 = await notifierManager.createSubscription(
        Provider,
        hash,
        signature,
        constants.ZERO_ADDRESS,
        2,
        { from: Consumer, value: 2 }
      )
      expectEvent(receipt2, 'SubscriptionCreated', {
        hash: hash,
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        amount: '2',
        consumer: Consumer
      })

      await expectRevert(
        notifierManager.refundFunds(
          hash,
          constants.ZERO_ADDRESS,
          10,
          { from: Provider }
        ),
        'NotifierManager: Amount is too big')
    })
  })

  describe('Pausable', () => {
    it('should not be able to register provider when paused', async () => {
      await notifierManager.pause({ from: Owner })
      expect(await notifierManager.paused()).to.be.eql(true)
      await expectRevert(
        notifierManager.registerProvider('testUrl', { from: Provider }),
        'Pausable: paused'
      )
    })
    it('should not be able to withdrawal  when paused', async () => {
      await notifierManager.pause({ from: Owner })
      expect(await notifierManager.paused()).to.be.eql(true)
      await expectRevert(
        notifierManager.withdrawFunds(subscriptionHash, constants.ZERO_ADDRESS, 2, { from: Consumer }),
        'Pausable: paused'
      )
    })
    it('should not be able to refunds when paused', async () => {
      await notifierManager.pause({ from: Owner })
      expect(await notifierManager.paused()).to.be.eql(true)
      await expectRevert(
        notifierManager.refundFunds(subscriptionHash, constants.ZERO_ADDRESS, 2, { from: Consumer }),
        'Pausable: paused'
      )
    })
    it('should not be able to create subscription when paused', async () => {
      await notifierManager.pause({ from: Owner })
      expect(await notifierManager.paused()).to.be.eql(true)
      await expectRevert(
        notifierManager.createSubscription(Provider, subscriptionHash, signature, constants.ZERO_ADDRESS, 2, { from: Consumer }),
        'Pausable: paused'
      )
    })
    it.skip('should not be able to deposit funds to subscription when paused', async () => {
      await notifierManager.pause({ from: Owner })
      expect(await notifierManager.paused()).to.be.eql(true)
      await expectRevert(
        notifierManager.depositFunds(Provider, subscriptionHash, constants.ZERO_ADDRESS, 2, { from: Consumer }),
        'Pausable: paused'
      )
    })
  })

  describe('Upgrades', () => {
    it('should allow owner to upgrade', async () => {
      const notifierManagerUpg = await upgrades.upgradeProxy(notifierManager.address, NotifierManagerV2)
      const version = await notifierManagerUpg.getVersion()
      expect(notifierManagerUpg.address).to.be.eq(notifierManager.address)
      expect(version).to.be.eq('V2')
    })
    it('should not allow non-owner to upgrade', async () => {
      await upgrades.admin.transferProxyAdminOwnership(Provider)
      await expectRevert.unspecified(
        upgrades.upgradeProxy(notifierManager.address, NotifierManagerV2)
      )
    })
  })
})
