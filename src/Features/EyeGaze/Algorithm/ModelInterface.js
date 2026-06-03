import {Vector} from "../../../SvgPlus/vector.js"
import KalmanFilter from "./Utils/kalman.js"
import { linspace } from "./Utils/other.js";

function sampleSelect(points, sampleRate){
  let samples = [];
  let remainder = [];
  let num_samples = Math.round(points.length * sampleRate);
  let tps = linspace(0, points.length - 1, num_samples);
  for (let pi = 0, si = 0; pi < points.length; pi++) {
    if (pi == Math.round(tps[si])) {
      samples.push(points[pi]);
      si++;
    } else {
      remainder.push(points[pi]);
    }
  }
  return [samples, remainder];
}

function getDeltaStats(deltas){
  let sum = new Vector(0);
  let mae = new Vector(0);
  let mse = 0;
  let n = 0;
  for (let v of deltas) {
    if (v instanceof Vector) {
      sum = sum.add(v);
      mae = mae.add(v.abs());
      mse += v.norm();
      n++;
    }
  }
  let mean = sum.div(n);
  mae = mae.div(n);
  mse = mse / n;

  let ss = new Vector(0);
  for (let v of deltas) {
    if (v instanceof Vector) {
      let e = v.sub(mean);
      ss = ss.add(e.mul(e));
    }
  }
  let std = ss.div(n).sqrt()
  return {mean, std, deltas, mae, mse};
}

/**
 * Interface for eye gaze models. This class should be extended by any model that
 * @template {Object} Features 
 *
 * @typedef {Object} DataPoint
 * @property {Features} X - The input features for the model
 * @property {Vector} y - The true output for the model (e.g. gaze point)
 */
class EyeGazeModelInterface {
  /** ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ **/
  /** ~~~~~~~~~~~~~~~~~~~~~~~ Methods to Implement ~~~~~~~~~~~~~~~~~~~~~~~~~ **/
  /** ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ **/

  /** 
   * This method should be overridden by subclasses to
   * train the model on the input data.
   * @override
   * @param {DataPoint[]} trainData
   */ 
  async train(trainData) {
  }

  /** 
   * This method should be overridden by subclasses to return a 
   * prediction based on the input features.
   * @override
   * @param {Features} x
   */ 
  predict(x){
    return new Vector(0);
  }

  /**
   * Return a string representation of the model for saving to local storage
   * @override
   * @return {String}
   */
  toString(){ }


  /**
   * Return true if the model is ready to make predictions.
   * @override
   * @return {boolean}
   */
  get isReady() {
    return this.validationResults != null;
  }


  /**
   * Create a model from a string representation
   * @param {String} str
   * @return {EyeGazeModelInterface}
   */
  static fromString(str){
  }


  /**
   * Load any resources required by the model (e.g. pre-trained weights, etc.)
   * @override
   * @return {Promise}
   */
  static loadResources(){
    return new Promise((resolve, reject) => {
      resolve();
    });
  }

  /** ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ **/
  /** ~~~~~~~~~~~~~~~~~~~~~~~~ Utility Methods ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ **/
  /** ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ **/


  /**
   * Train the model on the given data and return validation results.
   * @param {DataPoint[]} data
   * @param {Number} sampleRate
   */
  async trainAndValidate(data, sampleRate) {
    let [train, validation] = sampleSelect(data, sampleRate);
    await this.train(train);
    let trainstats = this.validate(train);
    let validstats = this.validate(validation);

    let validationResults = {train: trainstats, validation: validstats};
    this.validationResults = validationResults;
    return validationResults;
  }

  /**
   * Validate the model on the given validation data and return
   * statistics about the prediction errors.
   * @param {DataPoint[]} validationData
   */
  validate(validationData){
    let deltas = validationData.map(({X, y}) => {
      let yp = this.predict(X);
      let delta = null;
      if (yp instanceof Vector) {
        delta = yp.sub(y);
        delta.actual = y;
      }
      return delta
    });
    return getDeltaStats(deltas);
  }

  /**
   * Predict the output for the given input features, 
   * and apply the filter to the prediction.
   * @param {Features} x
   */
  predictAndFilter(x){
    // If no filter function then set it to a default kalman filter
    if (!(this.filter instanceof Function)) {
      this.kalman = KalmanFilter.default();
      this.filter = (v) => {
        let vf = null;
        if (v instanceof Vector) vf = new Vector(this.kalman.update([v.x, v.y]));
        return vf;
      }
    }

    let y0 = this.predict(x);
    let y = this.filter(y0)
    return y;
  }

  
  /**
   * Save the model to local storage
   */
  saveToStorage(){
    localStorage.setItem(this.name, this + "");
  }

  /**
   * Load a model from local storage
   * @return {EyeGazeModelInterface}
   */
  static loadFromStorage(){
      let str =localStorage.getItem(this.name); 
         
      if (typeof str === "string"){
        return this.fromString(str);
      } else {
        return null;
      }
  }


  /**
   * @return {String}
   */
  get name(){return this.__proto__.constructor.name}

  /**
   * @return {String}
   */
  static get name(){ return "model-name"}

  /**
   * @return {String}
   */
  static get color(){return "black"}
}

export {Vector, EyeGazeModelInterface}
