extern crate console_error_panic_hook;

mod pyin;
mod pad;

use ndarray::prelude::*;
use ndarray::CowArray;
// use ndarray_npy::WriteNpyExt;
use rayon::prelude::*;
use wasm_bindgen::prelude::*;

use pyin::{PYINExecutor, Framing, PadMode};

#[wasm_bindgen]
pub extern fn init_console() {
  console_error_panic_hook::set_once();
}

// #[derive(Parser)]
// #[clap(author, version, about)]

#[wasm_bindgen]
pub extern fn wasmPYin(
  wav: Vec<f32>,
  sr: u32,
  frame_length: usize,
  fmin: f64,
  fmax: f64,
  resolution: Option<f64>
) -> Vec<f32> {
  let mut pyin_exec = PYINExecutor::new(
    fmin,
    fmax,
    sr,
    frame_length,
    None,
    None,
    resolution,
  );

  let wav = CowArray::from(Array::from(wav));

  // let wav = wav.into();

  // let wav = Array::from(wav);

  // let wav = wav.mapv(|x| x as f32);

  
  let results: Vec<_> = if wav.shape()[0] > 1 {
    panic!("Cannot handle multi-dimensional input arrays.");
  } else {
      vec![pyin_exec.pyin(
          wav,
          f32::NAN,
          Framing::Center(PadMode::Constant(0.)),
      )]
  };

//   Not sure about the shape here...
  vec![results[0].0[0], results[0].2[0]]

  // let pyin_result =
  //     Array3::from_shape_fn(
  //         (3, results.len(), results[0].0.len()),
  //         |(i, j, k)| match i {
  //             0 => results[j].0[k],
  //             1 => results[j].1[k] as usize as f64,
  //             2 => results[j].2[k],
  //             _ => unreachable!(),
  //         },
  //     );

  // if cli.verbose && &cli.output != "-" {
  //     println!("f0 = {}", pyin_result.index_axis(Axis(0), 0));
  //     println!("voiced_flag = {}", pyin_result.index_axis(Axis(0), 1));
  //     println!("voiced_prob = {}", pyin_result.index_axis(Axis(0), 2));
  // }
  // pyin_result
  //     .write_npy(output_writer)
  //     .expect("Failed to write pyin result to file!");
}
