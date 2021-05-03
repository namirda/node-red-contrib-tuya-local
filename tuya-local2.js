const TuyaDev = require('tuyapi');
const {keyRename,getHumanTimeStamp,checkValidJSON,filterCommandByte} = require('./lib/utils');

module.exports = function(RED) {

	function TuyaNode(config) {
		RED.nodes.createNode(this,config);
		var node = this;
		this.Name = config.devName;
		this.Id = config.devId;
		this.Key = config.devKey;
		this.Ip = config.devIp;
		this.version = config.protocolVer;
		this.renameSchema = config.renameSchema;
		this.filterCB = config.filterCB;
		const dev_info =  {name:this.Name,ip:this.Ip,id:this.Id};
		const device = new TuyaDev({
			id: this.Id,
			key: this.Key,
			ip: this.Ip,
			version: this.version});

			// New variables sdded by Neil
			var timer = null;
			var set_timeout = true;         //Only set to false if the device has been disconnected deliberately - prevents autoreconnect
			var connection_timeout=10;      // Timeout in seconds for find/connect to device
			var retry_interval=10;          // Interval between connection retry attempts
			var objRenameSchema={};         // config.renameSchema is a JSON string - this is the object version
			var objInverseSchema={};        // This is the inverse schema
			var doRename=false;             // Set to true if renamescheme is a valid JSON string

			var nodeContext=this.context();

			// Default command strings for on/off
			// This is ugly but I don't know how else to do it!!

			var cmdOff={};
			var cc={};
			cmdOff.multiple=true;
			cc[config.defaultdps]=false;
			cmdOff.data=cc;

			var cmdOn={};
			var cc1={};
			cmdOn.multiple=true;
			cc1[config.defaultdps]=true;
			cmdOn.data=cc1;

		function connectDevice() {
			node.status({fill:"yellow",shape:"ring",text:"Searching for Device"});
			node.log(config.devName + " - Finding device");

	                // Try to find the device - we do this every time we connect because it might have changed ip
	
               		 device.find({'options': {'timeout':connection_timeout}}).then( () => {

 				node.status({fill:"yellow",shape:"dot",text:"Connecting"});
				node.log(config.devName + " - Device found OK - Connecting");

                                device.connect().then( () => {
                                }, (reason) => {
                                        node.status({fill:"red",shape:"ring",text:"Connect Failed: " + reason});
					node.warn(config.devName + " - Failed to connect - " + reason + " - retrying");
					timer_set();
                                });


                        },() => {
                        
			// find failed
                                node.error(config.devName + " - Device not found - Retrying in " + retry_interval + " seconds");
                                node.status({fill:"red",shape:"dot",text:"Device not found"});
				timer_set();	// try again
                        });
		}
		
		function timer_clear(){
			if(timer != null){
				clearTimeout(timer);
				timer=null;
			}
		}

		function timer_set(){
			timer_clear();
			timer=setTimeout(connectDevice, retry_interval*1000);
		}

		function disconnectDevice() {
			device.disconnect();
		}

		// Here we retrieve the data from context and send it to the device

		function sync2Context(){

			// Get array of keys

			var keys=nodeContext.keys();		// Get aray of keys


			// And construct object

			cc="{";
			var c=0;
			for ( key of keys){
				c+=1;
				var d=nodeContext.get(key);
				if(isNaN(d))d='"' + d + '"';	// Non numeric values need quotes
				cc+='"' + key + '":' +d; 
				if(c<keys.length)cc+=",";	// No comma on the last item
			}
			cc+="}";
			cc=JSON.parse(cc);

			node.log(config.devName + " - Sync Context - " + JSON.stringify(cc));

			// and sync

			setDevice(cc);	
		}


		// Save command to context

		function save2context(cmd){
			node.log(config.devName + " - Save Context - " + JSON.stringify(cmd));
			for (const key in cmd) {
				nodeContext.set(key,cmd[key]);		
			}
		}

		// Swaps keys and values in an object

		function swapJSON(json){
			var ret=Object.fromEntries(Object.entries(json).map(([k, v]) => [v, k]));
  			return ret;
		}
//
//		We try to be very command tolerant!!
//		Income can be a boolean true/false or numeric 0/1 or string true/on/1 or false/off/0
//		It can also be a json string with full details
 
		function setDevice(req) {

			node.log(config.devName + " - received command " + JSON.stringify(req));

			var req1=req;

			if(typeof req=="string"){
				if ( req.toLowerCase() == "request" ) {
					device.get({"schema":true});

				} else if ( req.toLowerCase() == "context" ) {
		
					sync2Context();

				} else if ( req.toLowerCase() == "connect" ) {

					if(!device.isConnected()){
						timer_clear();			// Clear any outstanding timer
						set_timout=true;		// Set auto connect
						connectDevice();
					}else{
						node.log(config.devName + " - Already Connected");
					}

				} else if ( req.toLowerCase() == "disconnect" ) {
					node.log(config.devName + " - Disconnecting");

					if(device.isConnected()){
						set_timeout=false;
						timer_clear();
						disconnectDevice();
					}else{
						node.log(config.devName + " - Already disconnected");
					}

				// toggle no longer works due to the renameschema

				} else if (req.toLowerCase() == "toggle") {
					node.log(config.devName + " - Toggle dps " + config.defaultdps);
					device.toggle(config.defaultdps);

				} else if (req.toLowerCase() == "on" || req.toLowerCase() == "true" || req.toLowerCase() =="1") {
	                                node.log(config.devName + " - " + JSON.stringify(cmdOn));
                                	device.set(cmdOn);

				} else if (req.toLowerCase() == "off" || req.toLowerCase() == "false" || req.toLowerCase()=="0") {
	                                node.log(config.devName + " - " + JSON.stringify(cmdOff));
        	                        device.set(cmdOff);

				// String can be valid JSON - convert to Object and process later

				} else if (checkValidJSON(req)){
                                	req1=JSON.parse(req);
                                	node.log("Converting JSON string to object " + JSON.stringify(req1));


				} else {
					node.warn(config.devName + " - Unexpected input string " + req1);
				}

			} 

			if (typeof req1=="boolean"){
				if(req1==true){
					node.log(config.devName + " - " + JSON.stringify(cmdOn));
					device.set(cmdOn);
				} else{
					node.log(config.devName + " - " + JSON.stringify(cmdOff));
					device.set(cmdOff);
				}


			// Allow numbers - 0 is false, everything else is true

			} else if (typeof req1=="number"){
				if (req==0){
        	                        node.log(config.devName + " - " + JSON.stringify(cmdOff));
	                                device.set(cmdOff);
				} else {
	                                node.log(config.devName + " - " + JSON.stringify(cmdOn));
        	                        device.set(cmdOn);
				}

			} else if (typeof req1=="object"){

//                      Convert input data according to schema if required

                        	if(doRename){
//	                                node.log("Converting Command According to Schema " + JSON.stringify(objRenameSchema));
        	                        req1 = keyRename(req1,objRenameSchema);
                        	}

				node.log(config.devName + " - " + JSON.stringify(req1));

				device.set({
					multiple:true,
					data: req1
				});
			}
		}

//************************************************************************************
// START SCRIPT

		// Check the renameSchema and get inverse

		// This function accepts a JSON string or object
		function isJSONValid(json){
		
			if (json==null){
				 return false;
			}

			if (typeof json == "string"){
				if (!checkValidJSON(json)){
					node.warn(config.devName + " - Rename Schema is not valid JSON - will be ignored");
					return false;
				}

				var json1=JSON.parse(json);
			}

			var keys=Object.keys(json1);
			if(checkForDuplicates(keys)){
				node.warn(config.devName + " - Rename Schema has duplicate keys - will be ignored");
				return false;
			}
			var vals=Object.values(json1);
			if(checkForDuplicates(vals)){
				node.warn(config.devName + " - Rename Schema has duplicate values - will be ignored");
				return false;
			}
			return true;
		}

		function checkForDuplicates(array) {
  			return new Set(array).size !== array.length;
		}

		doRename=isJSONValid(config.renameSchema);		
		
		if(doRename){

			// Parse the schema string and get inverse

			objRenameSchema=JSON.parse(config.renameSchema);
			objInverseSchema=swapJSON(objRenameSchema);

			node.log(config.devName + " - Rename schema is " + JSON.stringify(objRenameSchema));
//			node.log(config.devName + " - Inverse Schema is " + JSON.stringify(objInverseSchema));
		}

		// Initial Connection

		node.log(config.devName + " - Connect on Deploy");
		connectDevice();

		device.on('disconnected', () => {
			if (set_timeout){
				node.warn(config.devName + " - Unexpected Disconnect - Reconnecting in " + retry_interval + " seconds");
			}else {
				node.log(config.devName + " - Disconnected");
			}

			this.status({fill:"red",shape:"ring",text:"Disconnected at " + getHumanTimeStamp()});

			// Send msg saying not available

			dev_info.available = false
			msg = {data:dev_info}
			node.send(msg);

			// And reconnect if required

			if (set_timeout) {
				timer_set();
			}
		});


		device.on('connected', () => {
			this.status({fill:"green",shape:"dot",text: "Connected at " + getHumanTimeStamp()});
			node.log(config.devName + " - Connected");
			timer_clear();
			
		});

		device.on('error', error => {
			this.status({fill:"red",shape:"ring",text:"error: " + error});
			node.warn(error + " device: " + this.Name);
	
			// Disconnect and reconnect

			if(device.isConnected())disconnectDevice();
			timer_clear();
			connectDevice();
		});

		device.on('heartbeat', () => {
			node.log(config.devName + " - Heartbeat");
		});

//		The on data event is called after each data input - used to give some output

		device.on('data', (data,commandByte) => {
			if ("commandByte" !== null ) {
				dev_info.available = true;

				save2context(data.dps);

				if (doRename) {
					data.dps = keyRename(data.dps,objInverseSchema);
				}

				msg = {data:dev_info,commandByte:commandByte,payload:data};
				if (this.filterCB !== "") {
					node.send(filterCommandByte(msg,this.filterCB));
				} else {
					node.send(msg);
				}
			}
		});

		//Handle input to the node

		node.on('input', function(msg,send,done) {
			setDevice(msg.payload);
		});


		this.on('close', function(removed, done) {
			node.log(config.devName + " - Closing");
			set_timeout=false;
			timer_clear();

			if (device.isConnected() )disconnectDevice();

			done();
		});
// 
	}
	RED.nodes.registerType("tuya-local2",TuyaNode);
}

