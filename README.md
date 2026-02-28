# applocator
App Locator
The old day, a company usually use a real map hanging on the wall, then put a flag somewhere to show their product or service existence there. More city cover with flag means their product sold broader. 
Imagine this, I can view where's my POS app are used, how many online, how many offline as if I can see how many light bulb are on in the area, visually on Google Maps or Open Street Maps
I need 3 apps for this:
1. A mobile web application with Google Maps or Open Maps background overlay to visual view display
2. A code or module to embed / insert to my POS application. Its function is just ping or send a short code to  a server consist of a device ID and its position / location. This information used to generate visual display I mentioned in number 1. The ping repeat every 15 minutes. No ping for more than 15 minutes considered the  POS App is already closed. The visual dot color GREEN indicate the stores are open and grey indicate the stores are closed
3. A small PWA works as stand alone number 2 for testing purpose
4. Great concept — this is essentially a "living map" of your POS fleet, like a city seen from above with lights on/of
