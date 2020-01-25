'use strict';
 
const functions = require('firebase-functions');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
const requestAPI = require('request-promise');
const {BasicCard, Button, Image, List, BrowseCarousel, BrowseCarouselItem} = require('actions-on-google');

process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  const agent = new WebhookClient({ request, response });
  console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
  console.log('Dialogflow Request body: ' + JSON.stringify(request.body));

  const conv = agent.conv(); // Get Action on Google library conv instance

  if (conv !== null && conv.data.bitcoinInvestment === undefined) {
    conv.data.bitcoinInvestment = 10000;
  }
 
  function welcome(agent) {
    agent.add(`Welcome to my agent!`);
  }
 
  function fallback(agent) {
    agent.add(`I didn't understand`);
    agent.add(`I'm sorry, can you try again?`);
  }

  function formatDate(date) {
    let month = date.getMonth() + 1;
    if ( month < 10 ) month = '0' + month;
    let day = date.getDate();
    if ( day < 10 ) day = '0' + day;
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function getBitcoinPrice(dateToRead) {
    //Example: https://api.coindesk.com/v1/bpi/historical/close.json?start=2019-07-30&end=2019-07-30&currency=eur
    return requestAPI('https://api.coindesk.com/v1/bpi/historical/close.json?start=' + dateToRead +
      '&end=' + dateToRead + '&currency=eur')
      .then(function (data) {
        let bitcoinPrice = JSON.parse(data);
        if (bitcoinPrice.hasOwnProperty('bpi') && bitcoinPrice['bpi'].hasOwnProperty(dateToRead)) {
          return bitcoinPrice['bpi'][dateToRead];
        }
      }).catch(function (err) {
        console.log('No bitcoin data');
        console.log(err);
      });
  }

  async function calculateInvestment(investDate, sellDate) {

    let investPrice = await getBitcoinPrice(investDate);
    let sellPrice = await getBitcoinPrice(sellDate);

    let startBitcoin = conv.data.bitcoinInvestment / investPrice;
    let earned = startBitcoin * sellPrice - conv.data.bitcoinInvestment;

    return {
        investPrice,
        sellPrice,
        startBitcoin,
        earned
    };

  }

  function formatMoney(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
  }

  async function earnWithBitcoinPeriod() {

    if (!agent.parameters.hasOwnProperty('buyDate')) {
      agent.add(conv);
      return;
    }

    let dateUnit = (agent.parameters['buyDate'].hasOwnProperty('date-unit')) ?
      agent.parameters['buyDate']['date-unit'] : false; // Day, month or year

    let datePeriod = (agent.parameters['buyDate'].hasOwnProperty('date-period')) ?
      agent.parameters['buyDate']['date-period'] : false; // Beginning or end

    let number = (agent.parameters['buyDate'].hasOwnProperty('number')) ?
      agent.parameters['buyDate']['number'] : 0;
    if ( !datePeriod && number === 0 ) number = 1; // A period ago

    let now = new Date();
    let dateToCalculate = new Date();

    switch (dateUnit) {

      case 'day':
        dateToCalculate.setDate(now.getDate() - number);
        break;
      
      case 'month':
        dateToCalculate.setMonth(now.getMonth() - number);
        if (datePeriod === 'end') {
          dateToCalculate.setDate(new Date(now.getFullYear(), dateToCalculate.getMonth() + 1, 0).getDate());
        } else if (datePeriod === 'beginning') {
          dateToCalculate.setDate(1);
        }
        break;

      case 'year':
        if (datePeriod === 'end') {
          dateToCalculate.setDate(31);
          dateToCalculate.setMonth(11);
        } else if (datePeriod === 'beginning') {
          dateToCalculate.setDate(1);
          dateToCalculate.setMonth(0);
        }
        
        if ( number > 2000 ) dateToCalculate.setFullYear(number);
        else if ( number < 20 ) {
          dateToCalculate.setFullYear(now.getFullYear() - number);
        }
        break;

    }
    
    let investDate = formatDate(dateToCalculate);
    now.setDate(now.getDate() - 1);
    let sellDate = formatDate(now);
    let investment = await calculateInvestment(investDate, sellDate);

    let earned = formatMoney(investment.earned.toFixed(2));

    let response = 'Investment price on ' + dateToCalculate.toDateString() +
      ' was: ' + formatMoney(investment.investPrice.toFixed(2)) + '. ' +
      'With the investment of : ' + formatMoney(conv.data.bitcoinInvestment) + ' EURO ' +
      'you would buy ' + investment.startBitcoin.toFixed(2) + ' bitcoins. ' +
      'Selling price yesterday would be ' + formatMoney(investment.sellPrice.toFixed(2)) + ' EURO. ' +
      'If you sold your ' + investment.startBitcoin.toFixed(2) + ' of bitcoins' +
      ' you would have earned: ' + earned + ' euros ';
    
    conv.ask(response);
    conv.ask(new BasicCard({
      text: `Bitcoin price on ${dateToCalculate.toDateString()}: ${formatMoney(investment.investPrice.toFixed(2))}.  \n
        Investment: ${formatMoney(conv.data.bitcoinInvestment)} euro.  \n  
        Selling price yesterday: ${formatMoney(investment.sellPrice.toFixed(2))} euro.  \n   
        Revenue: ${earned} euros.  \n`,
      subtitle: `Investment date: ${dateToCalculate.toDateString()}`,
      title: `Investment return: ${earned} euros`,
      buttons: new Button({
        title: 'Buy bitcoins now',
        url: 'https://bitcoins.now/',
      }),
      display: 'CROPPED'
    }));
    agent.add(conv);

  }

  async function earnWithBitcoin() {
    
    let now = new Date();
    now.setDate(now.getDate() - 1);
    let sellDate = formatDate(now);

    // Beginning of the month
    let dateToCalculate = new Date();
    dateToCalculate.setDate(1);
    let startOfMonth = formatDate(dateToCalculate);

    // Beginning of the year
    dateToCalculate = new Date();
    dateToCalculate.setDate(1);
    dateToCalculate.setMonth(0);
    let startOfYear = formatDate(dateToCalculate);

    // One year ago
    dateToCalculate = new Date();
    dateToCalculate.setFullYear(now.getFullYear() - 1);
    let aYearAgo = formatDate(dateToCalculate);

    // Two years ago
    dateToCalculate = new Date();
    dateToCalculate.setFullYear(now.getFullYear() - 2);
    let twoYearAgo = formatDate(dateToCalculate);

    // Three years ago
    dateToCalculate = new Date();
    dateToCalculate.setFullYear(now.getFullYear() - 3);
    let threeYearAgo = formatDate(dateToCalculate);


    let investmentStartOfMonth = await calculateInvestment(startOfMonth, sellDate);
    let earnedStartOfMonth = formatMoney(investmentStartOfMonth.earned.toFixed(0));
    let priceStartOfMonth = formatMoney(investmentStartOfMonth.investPrice.toFixed(2));

    let investmentStartOfYear = await calculateInvestment(startOfYear, sellDate);
    let earnedStartOfYear = formatMoney(investmentStartOfYear.earned.toFixed(0));
    let priceStartOfYear  = formatMoney(investmentStartOfYear.investPrice.toFixed(2));

    let investmentAYearAgo = await calculateInvestment(aYearAgo, sellDate);
    let earnedAYearAgo = formatMoney(investmentAYearAgo.earned.toFixed(0));
    let priceAYearAgo = formatMoney(investmentAYearAgo.investPrice.toFixed(2));

    let investmentTwoYearAgo = await calculateInvestment(twoYearAgo, sellDate);
    let earnedTwoYearAgo = formatMoney(investmentTwoYearAgo.earned.toFixed(0));
    let priceTwoYearAgo = formatMoney(investmentTwoYearAgo.investPrice.toFixed(2));

    let investmentThreeYearAgo = await calculateInvestment(threeYearAgo, sellDate);
    let earnedThreeYearAgo = formatMoney(investmentThreeYearAgo.earned.toFixed(0));
    let priceThreeYearAgo = formatMoney(investmentThreeYearAgo.investPrice.toFixed(2));

    conv.ask(`This is how much you would earn with bitcoin if you invested ${formatMoney(conv.data.bitcoinInvestment)}`);
    
    conv.ask(new BrowseCarousel({
      items: [
        new BrowseCarouselItem({
          title: `Price ${priceStartOfMonth} euro`,
          url: `https://bitcoins.now`,
          description: `Beginning of this month`,
          image: new Image({
            url: `https://dummyimage.com/128x232/2b00ff/fff.png&text=${earnedStartOfMonth}`,
            alt: `Earning from beginning of this month ${earnedStartOfMonth} euro`,
          }),
          footer: `Buy bitcoin`,
        }),
        new BrowseCarouselItem({
          title: `Price ${priceStartOfYear} euro`,
          url: `https://bitcoins.now`,
          description: `Start of the year`,
          image: new Image({
            url: `https://dummyimage.com/128x232/2b00ff/fff.png&text=${earnedStartOfYear}`,
            alt: `Earning from beginning of this year ${earnedStartOfYear} euro`,
          }),
          footer: `Buy bitcoin`,
        }),
        new BrowseCarouselItem({
          title: `Price ${priceAYearAgo} euro`,
          url: `https://bitcoins.now`,
          description: `One year ago`,
          image: new Image({
            url: `https://dummyimage.com/128x232/2b00ff/fff.png&text=${earnedAYearAgo}`,
            alt: `Earning from one year ago ${earnedAYearAgo} euro`,
          }),
          footer: `Buy bitcoin`,
        }),
        new BrowseCarouselItem({
          title: `Price ${priceTwoYearAgo} euro`,
          url: `https://bitcoins.now`,
          description: `Two years ago`,
          image: new Image({
            url: `https://dummyimage.com/128x232/2b00ff/fff.png&text=${earnedTwoYearAgo}`,
            alt: `Earning from two years ago ${earnedTwoYearAgo} euro`,
          }),
          footer: `Buy bitcoin`,
        }),
        new BrowseCarouselItem({
          title: `Price ${priceThreeYearAgo} euro`,
          url: `https://bitcoins.now`,
          description: `Three years ago`,
          image: new Image({
            url: `https://dummyimage.com/128x232/2b00ff/fff.png&text=${earnedThreeYearAgo}`,
            alt: `Earning from three years ago ${earnedThreeYearAgo} euro`,
          }),
          footer: `Buy bitcoin`,
        })
      ]
    }));

    agent.add(conv);

  }

  // Run the proper function handler based on the matched Dialogflow intent name
  let intentMap = new Map();
  intentMap.set('Default Welcome Intent', welcome);
  intentMap.set('Default Fallback Intent', fallback);
  intentMap.set('Earn with Bitcoin', earnWithBitcoin);
  intentMap.set('Earn with Bitcoin in specific period', earnWithBitcoinPeriod);
  
  agent.handleRequest(intentMap);
});
