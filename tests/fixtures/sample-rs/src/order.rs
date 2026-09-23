use crate::store::save;

pub struct Order {
    pub id: String,
}

pub enum Status {
    New,
    Paid,
}

pub trait Payable {
    fn pay(&self) -> bool;
}

impl Order {
    pub fn total(&self) -> u64 {
        compute(self.id.len() as u64)
    }

    fn secret(&self) -> u64 {
        self.total()
    }
}

pub fn compute(n: u64) -> u64 {
    n * 2
}

mod tests {
    pub fn compute() -> u64 {
        super::compute(1)
    }
}
